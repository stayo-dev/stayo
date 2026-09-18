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

/**
 * POST /api/platform-admin/managers/[id]/hostels/[hostelId]/reassign
 * body { toManagerId }. `[id]` in the path is the *current* manager, used
 * only to make the URL self-describing in the UI — the actual reassignment
 * is resolved from the hostel's current active assignment server-side, so a
 * stale/wrong `[id]` in the URL cannot reassign the wrong manager's hostel
 * out from under them. ADMIN only. Old assignment row is closed, not
 * deleted, so its historical activity stays intact.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; hostelId: string }> },
) {
  const session = await getSession(req);
  const { hostelId } = await params;
  try {
    requireAdmin(session);
    const body = await req.json();
    const toManagerId: string | undefined = body?.toManagerId;
    if (!toManagerId) return apiError("toManagerId is required", "INVALID_INPUT", 422);

    const { previousManagerProfileId } = await managerService.reassignHostel(hostelId, toManagerId, session!.sub);
    await recordManagerActivity({
      actorProfileId: session!.sub,
      actorRole: "ADMIN",
      hostelId,
      actionType: "HOSTEL_REASSIGNED",
      entityType: "MANAGER_HOSTEL_ASSIGNMENT",
      entityId: hostelId,
      before: { manager_profile_id: previousManagerProfileId },
      after: { manager_profile_id: toManagerId },
    });

    const manager = await managerService.getManager(toManagerId);
    return apiResponse({ manager });
  } catch (error: any) {
    const status = error instanceof ManagerServiceError ? error.status : 500;
    return apiError(error.message, error.code || "ERROR", status);
  }
}
