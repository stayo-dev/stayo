export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { managerService, ManagerServiceError } from "@/src/services/managers/manager-service";
import { recordManagerActivity } from "@/src/services/managers/manager-activity";

function requireAdmin(session: any) {
  if (!session || session!.role !== "ADMIN") {
    throw new ManagerServiceError("Admin access only", "FORBIDDEN", 403);
  }
}

/** POST /api/platform-admin/managers/[id]/hostels — body { hostelIds: string[] }. Assign only; already-assigned hostels are rejected (use reassign). ADMIN only. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const body = await req.json();
    const hostelIds: string[] = Array.isArray(body?.hostelIds) ? body.hostelIds : [];
    if (hostelIds.length === 0) {
      return apiError("hostelIds must be a non-empty array", "INVALID_INPUT", 422);
    }
    const manager = await managerService.assignHostels(id, hostelIds, session!.sub);
    for (const hostelId of hostelIds) {
      await recordManagerActivity({
        actorProfileId: session!.sub,
        actorRole: "ADMIN",
        hostelId,
        actionType: "HOSTEL_ASSIGNED",
        entityType: "MANAGER_HOSTEL_ASSIGNMENT",
        entityId: hostelId,
        extra: { manager_profile_id: id },
      });
    }
    return apiResponse({ manager });
  } catch (error: any) {
    const status = error instanceof ManagerServiceError ? error.status : 500;
    return apiError(error.message, error.code || "ERROR", status);
  }
}
