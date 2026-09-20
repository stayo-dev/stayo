/**
 * WhatsApp invoice-PDF delivery for a generic owner-payment invoice —
 * mandatory alongside email (not a freeform-text nudge; see the note below
 * on why that approach was replaced).
 *
 * Reuses, never duplicates:
 *  - `owner_whatsapp_identities` for the owner's verified number (same table
 *    the DUES/PAY assistant already uses).
 *  - `MetaWhatsAppProvider` (via `whatsAppTemplateDeliveryService`, the
 *    repo's existing generic idempotent-template-delivery abstraction —
 *    `lib/services/notifications/whatsapp-template-delivery.ts`) for the
 *    actual send + `whatsapp_logs` bookkeeping. No new WhatsApp provider, no
 *    new delivery-tracking table.
 *  - `ownerInvoiceDocumentService` for the PDF/document URL — the exact same
 *    document the email attachment uses; nothing is re-generated twice for
 *    no reason.
 *
 * WHY A DOCUMENT TEMPLATE, NOT FREEFORM TEXT: a freeform WhatsApp message
 * (the earlier version of this file) can only be delivered inside Meta's
 * 24-hour customer-service session window — most owners are outside it,
 * most of the time. A template message has no such restriction, but Meta
 * requires it to be pre-approved, and it must carry the header/body shape
 * declared in `owner-invoice-template-contract.ts`. If that template is
 * missing/not approved in this environment, sending fails with a clear
 * `TEMPLATE_NOT_CONFIGURED` reason — this code never falls back to a
 * freeform message for the invoice itself.
 *
 * Delivery status is tracked entirely in the existing `whatsapp_logs` table
 * (via `whatsAppTemplateDeliveryService`), keyed by a per-invoice
 * idempotency-key prefix (`owner-invoice-whatsapp:<invoiceId>:<n>`) — no new
 * columns on `owner_invoices`, no new table. A retry uses the next `n`, so
 * Meta's own idempotency guard on `whatsapp_logs.idempotency_key` can never
 * silently swallow a genuine retry, while `getOwnerInvoiceWhatsAppStatus`
 * still finds "the current state" by taking the most recent row for that
 * prefix.
 */
import { prisma } from "@/lib/db";
import { formatPaiseInr } from "@/lib/pdf/subscription-invoice-content";
import {
  whatsAppTemplateDeliveryService,
} from "@/lib/services/notifications/whatsapp-template-delivery";
import {
  buildOwnerInvoiceTemplatePayload,
  ownerInvoiceTemplateLanguage,
  ownerInvoiceTemplateName,
} from "@/lib/services/notifications/providers/whatsapp/owner-invoice-template-contract";
import { ownerInvoiceDocumentService } from "./owner-invoice-document-service";
import { OwnerBillingError } from "./owner-billing-errors";

const IDEMPOTENCY_PREFIX = (invoiceId: string) => `owner-invoice-whatsapp:${invoiceId}:`;

export type OwnerInvoiceWhatsAppSendResult = {
  sent: boolean;
  reason?: "NO_VERIFIED_WHATSAPP" | "TEMPLATE_NOT_CONFIGURED" | "SEND_FAILED" | "INVOICE_NOT_FOUND";
  detail?: string;
  messageId?: string | null;
};

export type OwnerInvoiceWhatsAppStatus = {
  status: "PENDING" | "SENT" | "FAILED";
  sentAt: Date | null;
  messageId: string | null;
  error: string | null;
  attempts: number;
};

async function findVerifiedOwnerWhatsAppNumber(ownerId: string): Promise<string | null> {
  const identity = await prisma.owner_whatsapp_identities.findFirst({
    where: { owner_id: ownerId, is_verified: true, phone_number: { not: null } },
    orderBy: { verified_at: "desc" },
    select: { phone_number: true },
  });
  return identity?.phone_number ?? null;
}

/** The document URL the email step (or an earlier WhatsApp attempt) may have already generated — reused, never re-rendered needlessly. */
async function resolveDocumentUrl(invoiceId: string, existingUrl: string | null): Promise<string | null> {
  if (existingUrl) return existingUrl;
  const { documentUrl } = await ownerInvoiceDocumentService.generateDocument(invoiceId);
  return documentUrl;
}

/** Next free idempotency key for this invoice — `n` increments so a retry is a genuinely new send, not silently deduped by `whatsapp_logs`'s unique constraint. */
async function nextIdempotencyKey(invoiceId: string): Promise<string> {
  const prefix = IDEMPOTENCY_PREFIX(invoiceId);
  const count = await prisma.whatsapp_logs.count({ where: { idempotency_key: { startsWith: prefix } } });
  return `${prefix}${count + 1}`;
}

async function loadInvoiceForSend(invoiceId: string) {
  return prisma.owner_invoices.findUnique({
    where: { id: invoiceId },
    include: {
      profile: {
        select: { name: true, owner_billing_profile: { select: { billing_name: true } } },
      },
    },
  });
}

/**
 * Send the invoice PDF as a WhatsApp document-template message. Never
 * throws — every failure mode (no verified number, template not
 * configured/approved, provider rejection) resolves to
 * `{ sent: false, reason, detail? }` so the payment/invoice this describes
 * are never put at risk by a notification-channel problem.
 */
async function sendOwnerInvoiceWhatsAppDocument(invoiceId: string): Promise<OwnerInvoiceWhatsAppSendResult> {
  try {
    const invoice = await loadInvoiceForSend(invoiceId);
    if (!invoice) return { sent: false, reason: "INVOICE_NOT_FOUND" };

    const phone = await findVerifiedOwnerWhatsAppNumber(invoice.owner_id);
    if (!phone) return { sent: false, reason: "NO_VERIFIED_WHATSAPP" };

    const templateName = ownerInvoiceTemplateName();
    const health = await whatsAppTemplateDeliveryService.verifyTemplateHealth(templateName);
    if (!health.exists || String(health.status).toUpperCase() !== "APPROVED") {
      return {
        sent: false,
        reason: "TEMPLATE_NOT_CONFIGURED",
        detail: !health.exists
          ? `WhatsApp template "${templateName}" was not found. Set WHATSAPP_OWNER_INVOICE_TEMPLATE_NAME once it is created and approved in WhatsApp Manager.`
          : `WhatsApp template "${templateName}" is ${health.status}, not APPROVED.`,
      };
    }

    const documentUrl = await resolveDocumentUrl(invoice.id, invoice.document_url);
    if (!documentUrl) {
      return { sent: false, reason: "SEND_FAILED", detail: "Could not generate/upload the invoice PDF." };
    }

    const p: any = invoice.profile ?? {};
    const ownerName = p.owner_billing_profile?.billing_name || p.name || "there";
    const bodyParameters = buildOwnerInvoiceTemplatePayload({
      ownerName,
      amountLabel: formatPaiseInr(invoice.amount_paise + invoice.tax_paise),
      description: invoice.description,
      invoiceNumber: invoice.invoice_number,
    });

    const idempotencyKey = await nextIdempotencyKey(invoice.id);

    const result = await whatsAppTemplateDeliveryService.send({
      phone,
      templateName,
      bodyParameters,
      headerDocument: { link: documentUrl, filename: `Invoice_${invoice.invoice_number}.pdf` },
      languageCode: ownerInvoiceTemplateLanguage(),
      idempotencyKey,
      ownerId: invoice.owner_id,
    });

    return { sent: result.sent, messageId: result.providerMessageId ?? null };
  } catch (err: any) {
    // `whatsAppTemplateDeliveryService.send` throws on a provider-side
    // failure (already logged to `whatsapp_logs` before it throws) — that is
    // exactly the "surface a clear failure, never invalidate the payment"
    // contract this function promises its callers.
    console.warn("[owner-invoice-whatsapp] send failed (non-fatal):", err?.message);
    return { sent: false, reason: "SEND_FAILED", detail: err?.message };
  }
}

/**
 * Current WhatsApp delivery state for an invoice, for the admin UI — reads
 * the most recent `whatsapp_logs` row under this invoice's idempotency
 * prefix. `PENDING` covers "never attempted" (no row at all) the same as an
 * in-flight attempt, since both should render as "not yet delivered".
 */
async function getOwnerInvoiceWhatsAppStatus(invoiceId: string): Promise<OwnerInvoiceWhatsAppStatus> {
  const prefix = IDEMPOTENCY_PREFIX(invoiceId);
  const latest = await prisma.whatsapp_logs.findFirst({
    where: { idempotency_key: { startsWith: prefix } },
    orderBy: { created_at: "desc" },
  });

  if (!latest) return { status: "PENDING", sentAt: null, messageId: null, error: null, attempts: 0 };

  if (String(latest.status).toUpperCase() === "SENT") {
    return {
      status: "SENT",
      sentAt: latest.created_at,
      messageId: latest.provider_message_id,
      error: null,
      attempts: latest.attempt_count,
    };
  }
  if (String(latest.status).toUpperCase() === "FAILED") {
    return {
      status: "FAILED",
      sentAt: null,
      messageId: null,
      error: latest.provider_error_message,
      attempts: latest.attempt_count,
    };
  }
  return { status: "PENDING", sentAt: null, messageId: null, error: null, attempts: latest.attempt_count };
}

/**
 * Admin-initiated retry — sends the SAME invoice PDF again under a fresh
 * idempotency key. Never creates another payment or invoice; only ever
 * attempts a new WhatsApp delivery of the existing document.
 */
async function retryOwnerInvoiceWhatsApp(invoiceId: string): Promise<OwnerInvoiceWhatsAppSendResult> {
  const invoice = await prisma.owner_invoices.findUnique({ where: { id: invoiceId }, select: { id: true } });
  if (!invoice) throw new OwnerBillingError("Invoice not found.", "NOT_FOUND", 404);
  return sendOwnerInvoiceWhatsAppDocument(invoiceId);
}

export const ownerInvoiceWhatsAppService = {
  sendOwnerInvoiceWhatsAppDocument,
  getOwnerInvoiceWhatsAppStatus,
  retryOwnerInvoiceWhatsApp,
};
