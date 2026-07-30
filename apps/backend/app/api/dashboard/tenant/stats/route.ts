export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { dashboardService } from "@/lib/services/dashboard-service";
import { getCachedDashboard, setDashboardCache } from "@/lib/cache/dashboard-cache";
import { redisKeys } from "@/lib/redis/keys";


/**
 * 📊 TENANT DASHBOARD STATS
 * GET — Tenant-specific dashboard data
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Only tenants can access tenant dashboard", "FORBIDDEN", 403);
  }

  try {
    const cacheKey = redisKeys.dashboard.tenantStats(session.sub);
    const cached = await getCachedDashboard(cacheKey);
    if (cached) return apiResponse(cached);

    const stats = await dashboardService.getTenantStats(session.sub);
    await setDashboardCache(cacheKey, stats, 30, [
      redisKeys.tag.tenantDashboard(session.sub),
    ]);
    return apiResponse(stats);
  } catch (error: any) {
    if (error.message.startsWith("NOT_FOUND"))
      return apiError(error.message.split(": ")[1], "NOT_FOUND", 404);
    return apiError(error.message || "Failed to fetch tenant stats");
  }
}
