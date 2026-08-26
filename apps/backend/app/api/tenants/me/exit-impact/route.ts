export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiError, apiResponse } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { liveTenancyWhere } from "@/lib/tenancy/active-tenancy";
import { tenantReputationService } from "@/src/services/tenants/tenant-reputation-service";
import { EARLY_EXIT_DECAY_MONTHS } from "@/src/services/tenants/tenant-score-model";

/**
 * GET /api/tenants/me/exit-impact
 *
 * What leaving now would do to this tenant's score — for telling them
 * **before** they decide, not after.
 *
 * The tenant is not shown their score anywhere else; this is the one place the
 * number surfaces to them, and only because a consequence they cannot see is
 * not a consequence they can weigh. The figure comes from the same scorer the
 * owner reads, so the two cannot drift apart.
 *
 * Tenant-only: an owner has no business fetching this framing, and the tenant
 * whose stay it is has every right to it.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const tenant = await prisma.tenants.findFirst({
      where: liveTenancyWhere(session.sub),
      select: { id: true },
    });
    if (!tenant) return apiError("No active tenancy", "NOT_FOUND", 404);

    const projection = await tenantReputationService.projectExit(tenant.id);

    return apiResponse({
      current: projection.current,
      projected: projection.projected,
      drop: projection.drop,
      would_be_early: projection.wouldBeEarly,
      recovers_in_months: projection.recoversInMonths ?? EARLY_EXIT_DECAY_MONTHS,
    });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to project exit impact");
    if (msg.startsWith("NOT_FOUND")) return apiError(msg.split(": ")[1] ?? msg, "NOT_FOUND", 404);
    return apiError(msg);
  }
}
