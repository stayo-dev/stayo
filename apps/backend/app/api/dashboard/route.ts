export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { dashboardService } from "@/lib/services/dashboard-service";
import { activityService } from "@/lib/services/activity-service";
import { getCachedDashboard, setDashboardCache } from "@/lib/cache/dashboard-cache";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { redisKeys } from "@/lib/redis/keys";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { searchParams } = new URL(req.url);
  const monthsStr = searchParams.get("months");
  const months = monthsStr ? parseInt(monthsStr, 10) : 6;
  const hostelId = searchParams.get("hostelId") || undefined; // Phase 4: hostel isolation

  let scope;
  try {
    scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, hostelId);
    if (!hostelId) return apiError("hostelId is required", "HOSTEL_CONTEXT_REQUIRED", 400);
  } catch (error: any) {
    return apiError(error.message || "Forbidden", error.code || "FORBIDDEN", error.code === "UNAUTHORIZED" ? 401 : 403);
  }

  const cacheKey = redisKeys.dashboard.owner(scope.owner_id, hostelId, months);

  const cachedResult = await getCachedDashboard(cacheKey);
  if (cachedResult) {
    return apiResponse(cachedResult);
  }

  try {
    // Run everything in parallel! The real secret to production performance
    const [summary, monthlyStats, activityRes] = await Promise.all([
      dashboardService.getOwnerStatsShell(scope.owner_id, hostelId),
      dashboardService.getMonthlyStats(scope.owner_id, hostelId, months),
      activityService.getOwnerActivity({ userId: scope.owner_id, hostelId, limit: 5, offset: 0 }).catch(() => ({ items: [], total: 0 }))
    ]);

    const finalResponse = {
      stats: summary,
      collectionData: monthlyStats,
      recentActivity: activityRes?.items || []
    };

    await setDashboardCache(cacheKey, finalResponse, 45, [
      redisKeys.tag.ownerDashboard(scope.owner_id),
      redisKeys.tag.hostelDashboard(hostelId),
    ]);

    return apiResponse(finalResponse);
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch dashboard");
  }
}
