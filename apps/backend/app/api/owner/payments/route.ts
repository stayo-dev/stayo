export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { resolveOwnerId } from "@/src/services/owner-billing/owner-http";
import { ownerPaymentService } from "@/src/services/owner-billing/owner-payment-service";
import { ownerBillingErrorResponse } from "@/src/services/owner-billing/owner-http";

/**
 * GET /api/owner/payments
 *
 * The owner's own generic payment history (distinct from
 * `/api/owner/subscription`'s subscription payments) — surfaced in the
 * existing owner subscription/billing page, not a new owner app. `ownerId`
 * is session-resolved; the request never supplies one.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    const ownerId = resolveOwnerId(session);
    const payments = await ownerPaymentService.listForOwner(ownerId);
    return apiResponse({
      payments: payments.map((p: any) => ({
        id: p.id,
        amount_paise: p.amount_paise,
        payment_method: p.payment_method,
        description: p.description,
        status: p.status,
        created_at: p.created_at,
        invoice: p.owner_invoices
          ? {
              id: p.owner_invoices.id,
              invoice_number: p.owner_invoices.invoice_number,
              amount_paise: p.owner_invoices.amount_paise,
              issued_at: p.owner_invoices.issued_at,
            }
          : null,
      })),
    });
  } catch (error) {
    return ownerBillingErrorResponse(error, "owner.payments.list");
  }
}
