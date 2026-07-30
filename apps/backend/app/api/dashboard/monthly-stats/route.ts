export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { dashboardService } from "@/lib/services/dashboard-service";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { getCachedDashboard, setDashboardCache } from "@/lib/cache/dashboard-cache";
import { redisKeys } from "@/lib/redis/keys";


/**
 * 📊 DASHBOARD MONTHLY STATS (Charts)
 * GET — Monthly revenue/collection trends for owner dashboard
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const { searchParams } = new URL(req.url);
    const scope = resolveOwnerScope(session);
    const hostelId = searchParams.get("hostelId") || undefined;
    await requireHostelBelongsToOwner(scope.owner_id, hostelId);
    if (!hostelId) return apiError("hostelId is required", "HOSTEL_CONTEXT_REQUIRED", 400);
    const parseResult = parseInt(searchParams.get("months") || "6", 10);
    const months = Number.isNaN(parseResult) ? 6 : Math.max(1, Math.min(36, parseResult));
    const cacheKey = redisKeys.dashboard.monthly(scope.owner_id, hostelId, months);
    const cached = await getCachedDashboard(cacheKey);
    if (cached) return apiResponse(cached);

    const stats = await dashboardService.getMonthlyStats(scope.owner_id, hostelId, months);
    await setDashboardCache(cacheKey, stats, 120, [
      redisKeys.tag.ownerDashboard(scope.owner_id),
      redisKeys.tag.hostelDashboard(hostelId),
    ]);
    return apiResponse(stats);
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch monthly stats");
  }
}
