export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { subscriptionPaymentService } from "@/src/services/platform-billing/subscription-payment-service";
import { resolveOwnerId, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * POST /api/owner/subscription/payments
 *
 * The current owner submits a manual subscription payment (ADR-172, Phase 2).
 * Body: { plan_id, amount_paise, currency?, payment_method: 'UPI_MANUAL'|'CASH',
 *         transaction_reference?, proof_file_url?, extra_beds? }
 *
 * `extra_beds` (business rules, 2026-09-10) is validated server-side against
 * the plan's allowance — never trusted from the frontend alone.
 *
 * The payment is recorded as SUBMITTED. Only an admin can approve it — an owner
 * can never mark their own payment APPROVED. GATEWAY is rejected (Phase 2 has
 * no gateway). One payment awaiting review at a time.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  try {
    const ownerId = resolveOwnerId(session);
    const body = await req.json().catch(() => ({}));
    const payment = await subscriptionPaymentService.submitPayment(ownerId, {
      plan_id: body?.plan_id,
      amount_paise: body?.amount_paise,
      currency: body?.currency,
      payment_method: body?.payment_method,
      transaction_reference: body?.transaction_reference,
      proof_file_url: body?.proof_file_url,
      extra_beds: body?.extra_beds,
    });
    return apiResponse(
      {
        id: payment.id,
        status: payment.status,
        plan_id: payment.plan_id,
        amount_paise: payment.amount_paise,
        extra_beds: payment.extra_beds,
        currency: payment.currency,
        payment_method: payment.payment_method,
        submitted_at: payment.submitted_at,
      },
      201,
    );
  } catch (error) {
    return subscriptionErrorResponse(error, "owner.subscription.payments.post");
  }
}
