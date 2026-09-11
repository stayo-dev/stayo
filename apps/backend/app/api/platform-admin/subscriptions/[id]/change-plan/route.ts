export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { subscriptionAdminService } from "@/src/services/platform-billing/subscription-admin-service";
import { requireAdmin, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * POST /api/platform-admin/subscriptions/[id]/change-plan
 * Body: { plan_id, effective: 'IMMEDIATE' | 'NEXT_PERIOD', reason }
 *
 * Admin-only, audited. Server-side validation is not bypassed: the plan must
 * exist and be active; an IMMEDIATE move to a smaller plan whose capacity is
 * already exceeded is refused; FOUNDING still goes through the transaction-safe
 * first-10 reservation. NEXT_PERIOD just queues `pending_plan_id` for the
 * Phase 3 renewal logic to apply.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const body = await req.json().catch(() => ({}));
    const result = await subscriptionAdminService.changePlan({
      subscriptionId: id,
      adminId: (session as any).sub,
      planId: String(body?.plan_id ?? ""),
      effective: body?.effective === "NEXT_PERIOD" ? "NEXT_PERIOD" : "IMMEDIATE",
      reason: body?.reason,
      extraBeds: body?.extra_beds !== undefined ? Number(body.extra_beds) : 0,
    });
    return apiResponse(result);
  } catch (error) {
    return subscriptionErrorResponse(error, "platform-admin.subscriptions.change-plan");
  }
}
