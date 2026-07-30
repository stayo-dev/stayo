export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { assertHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { analyticsService, getDateRange } from "@/lib/services/analytics-service";
import { timed } from "@/lib/perf";
import { getCachedDashboard, setDashboardCache } from "@/lib/cache/dashboard-cache";
import { hashKey, redisKeys } from "@/lib/redis/keys";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { searchParams } = new URL(req.url);
  const { start, end } = getDateRange(searchParams.get("from"), searchParams.get("to"));
  const hostelId = searchParams.get("hostelId") || undefined;
  if (!hostelId) {
    return apiError("hostelId is required", "HOSTEL_CONTEXT_REQUIRED", 400);
  }

  try {
    const scope = resolveOwnerScope(session);
    await assertHostelBelongsToOwner(scope.owner_id, hostelId);
    const rangeHash = hashKey({ start: start.toISOString(), end: end.toISOString() });
    const cacheKey = redisKeys.analytics.cashflow(scope.owner_id, hostelId, rangeHash);
    const cached = await getCachedDashboard(cacheKey);
    if (cached) return apiResponse(cached);

    const data = await timed(
      "analytics.cashflow",
      () => analyticsService.getCashflowDashboard(scope.owner_id, start, end, hostelId),
      { owner_id: scope.owner_id, slow_ms: 1_500 }
    );
    await setDashboardCache(cacheKey, data, 180, [
      redisKeys.tag.ownerDashboard(scope.owner_id),
      redisKeys.tag.hostelDashboard(hostelId),
    ]);
    return apiResponse(data);
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch cashflow data");
  }
}
