export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { managerService, ManagerServiceError } from "@/src/services/managers/manager-service";
import { recordManagerActivity } from "@/src/services/managers/manager-activity";
import type { ManagerPermission } from "@prisma/client";

function requireAdmin(session: any) {
  if (!session || session!.role !== "ADMIN") {
    throw new ManagerServiceError("Admin access only", "FORBIDDEN", 403);
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const manager = await managerService.getManager(id);
    return apiResponse({ manager });
  } catch (error: any) {
    const status = error instanceof ManagerServiceError ? error.status : 500;
    return apiError(error.message, error.code || "ERROR", status);
  }
}

/** PATCH — edit name/phone and/or replace the permission set. ADMIN only; a manager can never call this on itself. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const body = await req.json();
    const before = await managerService.getManager(id);

    if (body.name !== undefined || body.phone !== undefined) {
      await managerService.updateManager(id, { name: body.name, phone: body.phone });
    }
    if (Array.isArray(body.permissions)) {
      await managerService.setPermissions(id, body.permissions as ManagerPermission[], session!.sub);
    }

    const after = await managerService.getManager(id);
    await recordManagerActivity({
      actorProfileId: session!.sub,
      actorRole: "ADMIN",
      actionType: "MANAGER_UPDATED",
      entityType: "MANAGER",
      entityId: id,
      before: { name: before.profile.name, phone: before.profile.phone, permissions: before.permissions.map((p: any) => p.permission) },
      after: { name: after!.profile.name, phone: after!.profile.phone, permissions: after!.permissions.map((p: any) => p.permission) },
    });

    return apiResponse({ manager: after });
  } catch (error: any) {
    const status = error instanceof ManagerServiceError ? error.status : 500;
    return apiError(error.message, error.code || "ERROR", status);
  }
}
