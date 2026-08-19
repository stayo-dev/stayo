export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeMealTimings } from "@/lib/services/food/meal-timings";

/**
 * GET /api/food/tenant/meal-timings
 * The tenant's own hostel's configured serving windows — read-only. Powers
 * the Next Serving card and Today's Meals status on the tenant Food/Home
 * pages. Same defaulting behaviour as the owner route: never blank.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const tenant = await prisma.tenants.findFirst({
      where: { profile_id: session.sub },
      select: { hostels: { select: { preferences_config: true } } },
    });
    if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);

    return apiResponse({ meal_timings: normalizeMealTimings(tenant.hostels.preferences_config) });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch meal timings");
  }
}
