export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdminOrManagerPermission } from "@/src/services/managers/manager-authorization";
import { ownerPaymentService } from "@/src/services/owner-billing/owner-payment-service";
import { ownerInvoiceWhatsAppService } from "@/src/services/owner-billing/owner-invoice-whatsapp-service";
import { OwnerBillingError } from "@/src/services/owner-billing/owner-billing-errors";
import { ownerBillingErrorResponse } from "@/src/services/owner-billing/owner-http";

/**
 * GET  /api/platform-admin/owners/[id]/payments — this owner's generic
 *      payment history (Billing / Payments section of the Owner drawer).
 * POST /api/platform-admin/owners/[id]/payments — "Add Payment": record a
 *      one-off charge for this owner (NOT a subscription payment — see the
 *      schema comment on `owner_payments`). Body:
 *      { amount_paise, payment_method, description, transaction_reference?,
 *        proof_file_url?, notes?, idempotency_key? }
 *
 * Reuses the same `MANAGE_SUBSCRIPTIONS` manager permission the rest of the
 * platform-billing admin surface uses — no new permission was needed.
 * Creates the payment + invoice atomically, then best-effort emails the
 * invoice to the owner. Audited (`OWNER_PAYMENT_CREATED`, `OWNER_INVOICE_CREATED`,
 * `OWNER_INVOICE_SENT`) via the existing `activity_logs` system.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    await requireAdminOrManagerPermission(session, "MANAGE_SUBSCRIPTIONS");

    const owner = await prisma.profile.findFirst({ where: { id, role: "OWNER" }, select: { id: true } });
    if (!owner) throw new OwnerBillingError("Owner not found.", "NOT_FOUND", 404);

    const payments = await ownerPaymentService.listForOwner(id);
    // One extra read per invoice (whatsapp_logs by idempotency-key prefix) —
    // fine at this list's scale (one owner's own payment history).
    const rows = await Promise.all(
      payments.map(async (p: any) => {
        const whatsapp = p.owner_invoices
          ? await ownerInvoiceWhatsAppService.getOwnerInvoiceWhatsAppStatus(p.owner_invoices.id)
          : null;
        return {
          id: p.id,
          amount_paise: p.amount_paise,
          payment_method: p.payment_method,
          description: p.description,
          transaction_reference: p.transaction_reference,
          notes: p.notes,
          status: p.status,
          created_at: p.created_at,
          invoice: p.owner_invoices
            ? {
                id: p.owner_invoices.id,
                invoice_number: p.owner_invoices.invoice_number,
                amount_paise: p.owner_invoices.amount_paise,
                issued_at: p.owner_invoices.issued_at,
                email: {
                  sent: Boolean(p.owner_invoices.emailed_at),
                  sent_at: p.owner_invoices.emailed_at,
                  failed_at: p.owner_invoices.email_failed_at,
                },
                whatsapp: whatsapp
                  ? {
                      status: whatsapp.status,
                      sent_at: whatsapp.sentAt,
                      error: whatsapp.error,
                    }
                  : { status: "PENDING", sent_at: null, error: null },
              }
            : null,
        };
      }),
    );
    return apiResponse({ payments: rows });
  } catch (error) {
    return ownerBillingErrorResponse(error, "platform-admin.owners.payments.list");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    await requireAdminOrManagerPermission(session, "MANAGE_SUBSCRIPTIONS");
    const body = await req.json().catch(() => ({}));

    const { payment, invoice, alreadyExisted } = await ownerPaymentService.createPayment({
      actorId: (session as any).sub,
      input: {
        ownerId: id, // path param is authoritative — never trust a body owner_id
        amountPaise: body?.amount_paise,
        paymentMethod: body?.payment_method,
        description: body?.description,
        transactionReference: body?.transaction_reference ?? null,
        proofFileUrl: body?.proof_file_url ?? null,
        notes: body?.notes ?? null,
        idempotencyKey: body?.idempotency_key ?? null,
      },
    });

    return apiResponse(
      {
        payment: {
          id: payment.id,
          amount_paise: payment.amount_paise,
          payment_method: payment.payment_method,
          description: payment.description,
          status: payment.status,
          created_at: payment.created_at,
        },
        invoice: invoice
          ? { id: invoice.id, invoice_number: invoice.invoice_number, amount_paise: invoice.amount_paise }
          : null,
        already_existed: alreadyExisted,
      },
      alreadyExisted ? 200 : 201,
    );
  } catch (error) {
    return ownerBillingErrorResponse(error, "platform-admin.owners.payments.create");
  }
}
