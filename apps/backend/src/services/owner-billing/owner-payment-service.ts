/**
 * Generic owner payments — a one-off amount Stayo collects from an owner for
 * something other than their subscription (see the schema comment in
 * `prisma/schema.prisma` above `owner_payments` for why this is a separate
 * model from `subscription_payments`).
 *
 * Flow: create payment + invoice atomically → audit → best-effort email PDF
 * → best-effort WhatsApp invoice-PDF document (via the approved WhatsApp
 * template, only when the owner has a verified WhatsApp connection — see
 * owner-invoice-whatsapp-service.ts). Both notification channels are
 * independent of each other and of the payment/invoice's own validity: a
 * failure in either is logged and retryable, never a reason to roll back
 * money already recorded. Admin/manager-authorized only; an owner can
 * list/read their own rows but never create, edit or void one (enforced by
 * the API routes, not here).
 */
import { prisma } from "@/lib/db";
import { activityService } from "@/lib/services/activity.service";
import { createOwnerInvoiceForPayment } from "./owner-invoice-service";
import { ownerInvoiceEmailService } from "./owner-invoice-email-service";
import { ownerInvoiceWhatsAppService } from "./owner-invoice-whatsapp-service";
import { OwnerBillingError } from "./owner-billing-errors";

const PAYMENT_METHODS = new Set(["CASH", "UPI", "BANK_TRANSFER"]);
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_NOTES_LENGTH = 1000;

type CreatePaymentInput = {
  ownerId: unknown;
  amountPaise: unknown;
  paymentMethod: unknown;
  description: unknown;
  transactionReference?: unknown;
  proofFileUrl?: unknown;
  notes?: unknown;
  idempotencyKey?: unknown;
};

function validate(input: CreatePaymentInput) {
  const ownerId = String(input.ownerId || "").trim();
  if (!ownerId) return { ok: false as const, reason: "ownerId is required." };

  const amount = Number(input.amountPaise);
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
    return { ok: false as const, reason: "amount_paise must be a positive whole number of paise." };
  }

  const method = String(input.paymentMethod || "").toUpperCase();
  if (!PAYMENT_METHODS.has(method)) {
    return { ok: false as const, reason: "payment_method must be one of CASH, UPI, BANK_TRANSFER." };
  }

  const description = String(input.description || "").trim();
  if (!description) return { ok: false as const, reason: "description is required." };
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false as const, reason: `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.` };
  }

  const notesRaw = input.notes !== undefined && input.notes !== null ? String(input.notes).trim() : "";
  if (notesRaw.length > MAX_NOTES_LENGTH) {
    return { ok: false as const, reason: `notes must be ${MAX_NOTES_LENGTH} characters or fewer.` };
  }

  return { ok: true as const, ownerId, amount, method, description, notes: notesRaw };
}

/**
 * Create a payment + its invoice atomically, then (outside the transaction)
 * audit-log and best-effort email the invoice. Idempotent on `idempotencyKey`
 * when the caller supplies one — a retried/double-clicked submit with the
 * same key resolves to the original row instead of creating a duplicate
 * charge, mirroring the tenant-payment `idempotency_key` pattern adapted to
 * this domain (no gateway/webhook involved here, just a client-generated key).
 */
async function createPayment(params: { actorId: string; input: CreatePaymentInput }) {
  const check = validate(params.input);
  if (!check.ok) throw new OwnerBillingError(check.reason, "INVALID_PAYMENT", 400);

  const owner = await prisma.profile.findFirst({ where: { id: check.ownerId, role: "OWNER" }, select: { id: true } });
  if (!owner) throw new OwnerBillingError("Owner not found.", "NOT_FOUND", 404);

  const idempotencyKey = params.input.idempotencyKey ? String(params.input.idempotencyKey).trim() || null : null;

  if (idempotencyKey) {
    const existing = await prisma.owner_payments.findUnique({ where: { idempotency_key: idempotencyKey } });
    if (existing) {
      const invoice = await prisma.owner_invoices.findUnique({ where: { payment_id: existing.id } });
      return { payment: existing, invoice, alreadyExisted: true };
    }
  }

  const transactionReference = params.input.transactionReference
    ? String(params.input.transactionReference).trim() || null
    : null;
  const proofFileUrl = params.input.proofFileUrl ? String(params.input.proofFileUrl).trim() || null : null;

  const { payment, invoice } = await prisma.$transaction(async (tx: any) => {
    const payment = await tx.owner_payments.create({
      data: {
        owner_id: check.ownerId,
        amount_paise: check.amount,
        payment_method: check.method as any,
        description: check.description,
        transaction_reference: transactionReference,
        proof_file: proofFileUrl,
        notes: check.notes || null,
        created_by: params.actorId,
        idempotency_key: idempotencyKey,
      },
    });
    const invoice = await createOwnerInvoiceForPayment(tx, payment);
    return { payment, invoice };
  });

  await activityService.log({
    userId: params.actorId,
    ownerId: check.ownerId,
    actionType: "OWNER_PAYMENT_CREATED",
    entityType: "owner_payments",
    entityId: payment.id,
    metadata: {
      amount_paise: payment.amount_paise,
      payment_method: payment.payment_method,
      description: payment.description,
      invoice_id: invoice.id,
    },
  });
  await activityService.log({
    userId: params.actorId,
    ownerId: check.ownerId,
    actionType: "OWNER_INVOICE_CREATED",
    entityType: "owner_invoices",
    entityId: invoice.id,
    metadata: { invoice_number: invoice.invoice_number, payment_id: payment.id, amount_paise: invoice.amount_paise },
  });

  // Best-effort — never lets an email problem invalidate the payment/invoice
  // already committed above. `sendOwnerInvoiceEmail` itself never throws.
  const emailResult = await ownerInvoiceEmailService.sendOwnerInvoiceEmail(invoice.id);
  if (emailResult.sent) {
    await activityService.log({
      userId: params.actorId,
      ownerId: check.ownerId,
      actionType: "OWNER_INVOICE_SENT",
      entityType: "owner_invoices",
      entityId: invoice.id,
      metadata: { invoice_number: invoice.invoice_number },
    });
  }

  // Best-effort, but a REQUIRED part of the notification workflow — sends
  // the same invoice PDF as a WhatsApp document-template message (never a
  // freeform text fallback). Independent of the email step above: a failure
  // here never throws and never affects the payment/invoice's validity.
  const whatsappResult = await ownerInvoiceWhatsAppService.sendOwnerInvoiceWhatsAppDocument(invoice.id);
  await activityService.log({
    userId: params.actorId,
    ownerId: check.ownerId,
    actionType: whatsappResult.sent ? "OWNER_INVOICE_WHATSAPP_SENT" : "OWNER_INVOICE_WHATSAPP_FAILED",
    entityType: "owner_invoices",
    entityId: invoice.id,
    metadata: {
      invoice_number: invoice.invoice_number,
      message_id: whatsappResult.messageId ?? null,
      reason: whatsappResult.reason ?? null,
      detail: whatsappResult.detail ?? null,
    },
  });

  return { payment, invoice, alreadyExisted: false, emailResult, whatsappResult };
}

async function listForOwner(ownerId: string) {
  return prisma.owner_payments.findMany({
    where: { owner_id: ownerId },
    orderBy: { created_at: "desc" },
    include: { owner_invoices: true },
  });
}

/**
 * Void a past payment — the correction mechanism instead of editing/deleting
 * a historical financial record. Leaves the row (and its invoice) intact;
 * `status = VOIDED` is what the admin/owner UI reads to grey it out. A real
 * correction is a brand-new `owner_payments` row, never an edit to this one.
 */
async function voidPayment(params: { paymentId: string; actorId: string; reason: string }) {
  const reason = String(params.reason || "").trim();
  if (!reason) throw new OwnerBillingError("A reason is required to void a payment.", "REASON_REQUIRED", 400);

  const res = await prisma.owner_payments.updateMany({
    where: { id: params.paymentId, status: "RECORDED" },
    data: { status: "VOIDED", voided_at: new Date(), voided_by: params.actorId, void_reason: reason, updated_at: new Date() },
  });
  if (res.count !== 1) {
    throw new OwnerBillingError("Payment not found or already voided.", "NOT_REVIEWABLE", 409);
  }

  const payment = await prisma.owner_payments.findUnique({ where: { id: params.paymentId } });
  await activityService.log({
    userId: params.actorId,
    ownerId: payment!.owner_id,
    actionType: "OWNER_PAYMENT_VOIDED",
    entityType: "owner_payments",
    entityId: params.paymentId,
    metadata: { reason },
  });
  return payment;
}

export const ownerPaymentService = {
  createPayment,
  listForOwner,
  voidPayment,
};
