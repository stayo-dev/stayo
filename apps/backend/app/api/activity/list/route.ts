export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { activityService } from "@/lib/services/activity-service";
import { requireHostelBelongsToOwner, resolveOwnerOrAdminScopeForHostel } from "@/lib/security/scoped-query";


/**
 * 🔍 Audit & Activity Timeline
 * Access: Owner/Admin only, hostel-scoped
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { searchParams } = new URL(req.url);
  const hostelId = searchParams.get("hostelId");
  const isUuid = hostelId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hostelId);
  if (!isUuid) {
    return apiError("hostelId must be a valid UUID", "BAD_REQUEST", 400);
  }

  let ownerId: string;
  try {
    ownerId = await resolveOwnerOrAdminScopeForHostel(session, hostelId);
  } catch (error: any) {
    return apiError(error.message, error.code || "FORBIDDEN", 403);
  }

  const search = searchParams.get("search") || undefined;
  const type = searchParams.get("type") || undefined;
  const tenantId = searchParams.get("tenantId") || undefined;
  const offset = parseInt(searchParams.get("offset") || "0");
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);

  try {
    const activity = await activityService.getOwnerActivity({
      userId: ownerId,
      hostelId,
      tenantId,
      search,
      type,
      offset,
      limit
    });

    return apiResponse(activity);
  } catch (error: any) {
    console.error("[activity.list] Failed to fetch activity logs", error);
    return apiError(error.message || "Failed to fetch activity logs");
  }
}
