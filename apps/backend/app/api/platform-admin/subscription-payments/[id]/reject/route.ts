export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { subscriptionPaymentService } from "@/src/services/platform-billing/subscription-payment-service";
import { requireAdmin, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * POST /api/platform-admin/subscription-payments/[id]/reject
 * Body: { reason: string }  — required, shown to the owner.
 *
 * Admin-only (ADR-172, Phase 2). Marks the payment REJECTED and leaves the
 * subscription untouched. A payment can be reviewed only once. The owner may
 * then submit a new payment.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const body = await req.json().catch(() => ({}));
    const result = await subscriptionPaymentService.reviewPayment({
      paymentId: id,
      decision: "REJECT",
      adminId: (session as any).sub,
      reason: body?.reason,
    });
    return apiResponse(result);
  } catch (error) {
    return subscriptionErrorResponse(error, "platform-admin.subscription-payments.reject");
  }
}
