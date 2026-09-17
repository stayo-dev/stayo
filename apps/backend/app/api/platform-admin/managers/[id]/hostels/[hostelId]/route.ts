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

/** DELETE /api/platform-admin/managers/[id]/hostels/[hostelId] — unassign. ADMIN only. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; hostelId: string }> },
) {
  const session = await getSession(req);
  const { id, hostelId } = await params;
  try {
    requireAdmin(session);
    const manager = await managerService.unassignHostel(id, hostelId, session!.sub);
    await recordManagerActivity({
      actorProfileId: session!.sub,
      actorRole: "ADMIN",
      hostelId,
      actionType: "HOSTEL_UNASSIGNED",
      entityType: "MANAGER_HOSTEL_ASSIGNMENT",
      entityId: hostelId,
      extra: { manager_profile_id: id },
    });
    return apiResponse({ manager });
  } catch (error: any) {
    const status = error instanceof ManagerServiceError ? error.status : 500;
    return apiError(error.message, error.code || "ERROR", status);
  }
}
