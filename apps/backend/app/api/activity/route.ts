import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { activityService } from "@/lib/services/activity-service";
import { requireHostelBelongsToOwner, resolveOwnerOrAdminScopeForHostel } from "@/lib/security/scoped-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/activity?hostelId=<uuid>&...
 *
 * Returns paginated activity events (payments + allocations) scoped strictly
 * to the given hostel. hostelId is required — no owner-wide fallback.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const { searchParams } = new URL(req.url);
    const hostelId = searchParams.get("hostelId") || undefined;
    const isUuid = hostelId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hostelId);
    if (!isUuid) {
      return apiError("hostelId must be a valid UUID", "HOSTEL_CONTEXT_REQUIRED", 400);
    }

    const ownerId = await resolveOwnerOrAdminScopeForHostel(session, hostelId);

    const search     = searchParams.get("search")     || undefined;
    const type       = searchParams.get("event_type") || undefined;
    const tenantId   = searchParams.get("tenantId")   || undefined;
    const start_date = searchParams.get("start_date") || undefined;
    const end_date   = searchParams.get("end_date")   || undefined;
    const limit      = Math.max(1, Math.min(100, parseInt(searchParams.get("limit")  || "20")));
    const offset     = Math.max(0, parseInt(searchParams.get("offset") || "0"));

    const activity = await activityService.getOwnerActivity({
      userId: ownerId,
      hostelId,
      tenantId,
      search,
      type,
      limit,
      offset,
      start_date,
      end_date,
    });

    return apiResponse(activity);
  } catch (error: any) {
    if (error.code === "HOSTEL_CONTEXT_REQUIRED" || error.code === "HOSTEL_NOT_FOUND") {
      return apiError(error.message, error.code, 400);
    }
    if (error.code === "FORBIDDEN" || error.message?.startsWith("FORBIDDEN")) {
      return apiError(error.message, "FORBIDDEN", 403);
    }
    return apiError(error.message || "Failed to fetch activity");
  }
}
