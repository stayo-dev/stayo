export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { portfolioPerformanceService } from "@/lib/services/portfolio-performance-service";
import { getCachedDashboard, setDashboardCache } from "@/lib/cache/dashboard-cache";
import { redisKeys } from "@/lib/redis/keys";

import { resolveOwnerOrAdminScopeForHostel } from "@/lib/security/scoped-query";

/**
 * GET /api/dashboard/portfolio-performance
 * Portfolio-wide revenue trends and hostel rankings (owner scope).
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const ownerId = await resolveOwnerOrAdminScopeForHostel(session);
    const { searchParams } = new URL(req.url);
    const parsed = parseInt(searchParams.get("months") || "6", 10);
    const months = Number.isNaN(parsed) ? 6 : parsed;
    const cacheKey = redisKeys.portfolio.performance(ownerId, months);
    const cached = await getCachedDashboard(cacheKey);
    if (cached) return apiResponse(cached);

    const data = await portfolioPerformanceService.getPortfolioPerformance(ownerId, months);
    await setDashboardCache(cacheKey, data, 120, [
      redisKeys.tag.ownerDashboard(ownerId),
    ]);
    return apiResponse(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch portfolio performance";
    return apiError(message);
  }
}
