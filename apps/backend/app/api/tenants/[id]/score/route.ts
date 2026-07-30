export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiError, apiResponse } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { tenantScoreService } from "@/src/services/tenants/tenant-score-service";
import { prisma } from "@/lib/db";

/**
 * GET /api/tenants/:id/score
 * Owner-accessible endpoint to view a specific tenant's behavior score.
 * Validates ownership before returning score data.
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

    // Verify the tenant belongs to this owner
    const tenant = await prisma.tenants.findFirst({
      where: { id: tenantId, owner_id: scope.owner_id },
      select: { id: true, profile_id: true, status: true },
    });

    if (!tenant) {
      return apiError("Tenant not found", "NOT_FOUND", 404);
    }

    // Tenants without a profile yet (invited but not activated) have no
    // behavior history to score — return a neutral default instead of
    // querying by a null profile_id, which Prisma rejects.
    if (!tenant.profile_id) {
      return apiResponse({
        score: 100,
        grade: "EXCELLENT",
        trend: "STABLE",
        status: "Excellent Standing",
        insights: ["No activity yet — this tenant hasn't completed registration."],
        suggestions: [],
        updated_at: null,
      });
    }

    const summary = await tenantScoreService.getTenantScoreSummary(tenant.profile_id);
    return apiResponse(summary);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch tenant score");
    if (msg.startsWith("NOT_FOUND")) {
      return apiError(msg.split(": ")[1] || "Tenant not found", "NOT_FOUND", 404);
    }
    return apiError(msg);
  }
}
