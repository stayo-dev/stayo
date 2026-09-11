export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { subscriptionPaymentService } from "@/src/services/platform-billing/subscription-payment-service";
import { resolveOwnerId, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * POST /api/owner/subscription/founding-renewal-payments
 *
 * Founding Partner only (business rules, 2026-09-12). Body: { payment_method:
 * 'UPI_MANUAL'|'CASH', transaction_reference?, proof_file_url? } — deliberately
 * NO amount and NO extra_beds field. The owner never enters or influences the
 * amount; the backend computes it from their live active-tenant count (the
 * same figure `founding-renewal-preview` just showed them) and ignores
 * anything else the client might send. Recorded as SUBMITTED — only an admin
 * can approve it.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  try {
    const ownerId = resolveOwnerId(session);
    const body = await req.json().catch(() => ({}));
    const payment = await subscriptionPaymentService.submitFoundingRenewalPayment(ownerId, {
      payment_method: body?.payment_method,
      transaction_reference: body?.transaction_reference,
      proof_file_url: body?.proof_file_url,
    });
    return apiResponse(
      {
        id: payment.id,
        status: payment.status,
        plan_id: payment.plan_id,
        amount_paise: payment.amount_paise,
        extra_beds: payment.extra_beds,
        payment_method: payment.payment_method,
        submitted_at: payment.submitted_at,
      },
      201,
    );
  } catch (error) {
    return subscriptionErrorResponse(error, "owner.subscription.founding-renewal-payments.post");
  }
}
