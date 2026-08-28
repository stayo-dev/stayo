export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiError, apiResponse } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { tenantReputationService } from "@/src/services/tenants/tenant-reputation-service";
import { EARLY_EXIT_DECAY_MONTHS } from "@/src/services/tenants/tenant-score-model";
import { prisma } from "@/lib/db";

/**
 * GET /api/tenants/:id/score
 *
 * How credible this tenant is, for the owner deciding how to manage them.
 *
 * The score is computed across every tenancy the **person** has held, not just
 * this one — see `tenant-reputation-service` for why that crosses a boundary
 * the document vault deliberately does not. The narrative does not cross:
 * `insights` describe behaviour at the calling owner's hostel only.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { id: tenantId } = await params;

  try {
    const scope = resolveOwnerScope(session);

    const tenant = await prisma.tenants.findFirst({
      where: { id: tenantId, owner_id: scope.owner_id },
      select: { id: true, profile_id: true, status: true },
    });

    if (!tenant) {
      return apiError("Tenant not found", "NOT_FOUND", 404);
    }

    /**
     * An invited tenant who has not activated has no behaviour to score. This
     * used to answer `score: 100, grade: "EXCELLENT"` — presenting someone who
     * had never paid anything as the best kind of tenant, which is exactly the
     * case an owner most needs warning about.
     */
    if (!tenant.profile_id) {
      return apiResponse({
        score: null,
        grade: null,
        status: "INSUFFICIENT_HISTORY",
        cycles_needed: null,
        components: { paymentReliability: null, commitment: null },
        early_exits: 0,
        trend: "STABLE",
        insights: [],
        recovers_in_months: EARLY_EXIT_DECAY_MONTHS,
      });
    }

    return apiResponse(await tenantReputationService.getForOwner(tenant.id));
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch tenant score");
    if (msg.startsWith("NOT_FOUND")) {
      return apiError(msg.split(": ")[1] || "Tenant not found", "NOT_FOUND", 404);
    }
    return apiError(msg);
  }
}
