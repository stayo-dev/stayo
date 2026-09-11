export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { subscriptionPaymentService } from "@/src/services/platform-billing/subscription-payment-service";
import { requireAdmin, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * POST /api/platform-admin/subscription-payments/cash
 * Body: { owner_id, plan_id, amount_paise, reference?, extra_beds? }
 *
 * Admin records a CASH subscription payment for an owner (ADR-172, Phase 5).
 * This is owner → Stayo — distinct from tenant-rent cash. It creates a
 * SUBMITTED `subscription_payments` row; the admin then APPROVES it via
 * `/subscription-payments/[id]/approve` (the same atomic transaction). There is
 * no shortcut that activates a subscription without a payment record + review.
 * Audited (`SUBSCRIPTION_PAYMENT_SUBMITTED`, `recorded_by: ADMIN`).
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const body = await req.json().catch(() => ({}));
    const payment = await subscriptionPaymentService.recordCashPayment((session as any).sub, {
      ownerId: String(body?.owner_id ?? ""),
      planId: String(body?.plan_id ?? ""),
      amountPaise: Number(body?.amount_paise),
      reference: body?.reference ?? null,
      extraBeds: body?.extra_beds !== undefined ? Number(body.extra_beds) : 0,
    });
    return apiResponse(
      {
        id: payment.id,
        owner_id: payment.owner_id,
        plan_id: payment.plan_id,
        amount_paise: payment.amount_paise,
        extra_beds: payment.extra_beds,
        payment_method: payment.payment_method,
        status: payment.status,
        submitted_at: payment.submitted_at,
      },
      201,
    );
  } catch (error) {
    return subscriptionErrorResponse(error, "platform-admin.subscription-payments.cash");
  }
}
