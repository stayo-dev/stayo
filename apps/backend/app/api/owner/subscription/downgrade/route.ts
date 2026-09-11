export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { subscriptionDowngradeService } from "@/src/services/platform-billing/subscription-downgrade-service";
import { resolveOwnerId, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * POST /api/owner/subscription/downgrade   Body: { plan_id }
 *
 * Schedules a switch to a cheaper plan (ADR-172, Phase 5). Sets
 * `pending_plan_id`; the current plan and capacity stay unchanged until the
 * next renewal, when the Phase 3 renewal logic applies it at the new plan's
 * full price. **No immediate payment.** Owner-scoped by session.
 *
 * DELETE — cancel a scheduled downgrade; the current plan simply continues.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  try {
    const ownerId = resolveOwnerId(session);
    const body = await req.json().catch(() => ({}));
    const planId = String(body?.plan_id ?? "").trim();
    if (!planId) return apiError("plan_id is required.", "VALIDATION_ERROR", 400);
    const result = await subscriptionDowngradeService.scheduleDowngrade(ownerId, planId);
    return apiResponse(result);
  } catch (error) {
    return subscriptionErrorResponse(error, "owner.subscription.downgrade.schedule");
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession(req);
  try {
    const ownerId = resolveOwnerId(session);
    const result = await subscriptionDowngradeService.cancelPendingDowngrade(ownerId);
    return apiResponse(result);
  } catch (error) {
    return subscriptionErrorResponse(error, "owner.subscription.downgrade.cancel");
  }
}
