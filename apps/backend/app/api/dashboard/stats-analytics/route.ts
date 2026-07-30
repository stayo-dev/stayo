export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { dashboardService } from "@/lib/services/dashboard-service";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner, resolveHostelContext } from "@/lib/security/scoped-query";
import { getCachedDashboard, setDashboardCache } from "@/lib/cache/dashboard-cache";
import { redisKeys } from "@/lib/redis/keys";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const hostelIdParam = req.nextUrl.searchParams.get("hostelId") || undefined;
    const { ownerId, hostelId } = await resolveHostelContext(session, hostelIdParam);

    const cacheKey = redisKeys.dashboard.statsAnalytics(ownerId, hostelId);
    const cached = await getCachedDashboard(cacheKey);
    if (cached) return apiResponse(cached);

    const analytics = await dashboardService.getOwnerStatsAnalytics(ownerId, hostelId);
    await setDashboardCache(cacheKey, analytics, 180, [
      redisKeys.tag.ownerDashboard(ownerId),
      redisKeys.tag.hostelDashboard(hostelId),
    ]);

    return apiResponse(analytics);
  } catch (error: any) {
    console.error("Detailed API Error [dashboard.stats-analytics]:", error);
    if (error.code === "HOSTEL_NOT_FOUND" || error.message?.startsWith("HOSTEL_NOT_FOUND")) {
      return Response.json({ success: false, error: "HOSTEL_NOT_FOUND" }, { status: 404 });
    }
    if (error.code === "FORBIDDEN" || error.message?.startsWith("FORBIDDEN")) {
      return apiError(error.message, "FORBIDDEN", 403);
    }
    return apiError(error.message || "Failed to fetch dashboard stats analytics");
  }
}
