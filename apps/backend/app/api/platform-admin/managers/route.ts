export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { managerService, ManagerServiceError } from "@/src/services/managers/manager-service";
import { managerInvitationService } from "@/src/services/managers/manager-invitation-service";
import type { ManagerPermission } from "@prisma/client";

function requireAdmin(session: any) {
  if (!session || session!.role !== "ADMIN") {
    throw new ManagerServiceError("Admin access only", "FORBIDDEN", 403);
  }
}

/** GET /api/platform-admin/managers?search=&status= — ADMIN only. */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const { searchParams } = new URL(req.url);
    const managers = await managerService.listManagers({
      search: searchParams.get("search")?.trim() || undefined,
      status: searchParams.get("status")?.trim() || undefined,
    });
    return apiResponse({ managers });
  } catch (error: any) {
    const status = error instanceof ManagerServiceError ? error.status : 500;
    return apiError(error.message, error.code || "ERROR", status);
  }
}

/** POST /api/platform-admin/managers — create + auto-send invitation. ADMIN only. */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const body = await req.json();
    const manager = await managerService.createManager({
      name: body.name,
      phone: body.phone,
      email: body.email,
      permissions: (body.permissions ?? []) as ManagerPermission[],
      invitedBy: session!.sub,
    });
    const invitation = await managerInvitationService.sendInvitation(manager!.id);
    return apiResponse({ manager, invitation }, 201);
  } catch (error: any) {
    const status = error instanceof ManagerServiceError ? error.status : 500;
    return apiError(error.message, error.code || "ERROR", status);
  }
}
