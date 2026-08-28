export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiError, apiResponse } from "@/lib/auth";
import { tenantReputationService } from "@/src/services/tenants/tenant-reputation-service";
import { EARLY_EXIT_DECAY_MONTHS } from "@/src/services/tenants/tenant-score-model";

/**
 * GET /api/tenants/me/score
 *
 * The tenant's own score. Points at the same scorer the owner reads — leaving
 * this on the previous algorithm would have shown the two parties different
 * numbers for the same person, which is the kind of disagreement nobody can
 * explain once it reaches a conversation.
 *
 * Unlike the owner's view, insights are not narrowed by hostel: this is the
 * person's own history and all of it is theirs to see.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Only tenants can access tenant score", "FORBIDDEN", 403);
  }

  try {
    const result = await tenantReputationService.getForProfile(session.sub);
    return apiResponse({
      score: result.score,
      grade: result.grade,
      status: result.status,
      trend: result.trend,
      cycles_needed: result.cyclesNeeded,
      components: result.components,
      early_exits: result.earlyExits,
      insights: result.insights,
      recovers_in_months: EARLY_EXIT_DECAY_MONTHS,
    });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch tenant score");
    if (msg.startsWith("NOT_FOUND")) return apiError(msg.split(": ")[1] || "Tenant record not found", "NOT_FOUND", 404);
    return apiError(msg);
  }
}
