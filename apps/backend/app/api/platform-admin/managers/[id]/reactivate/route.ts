export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { managerService, ManagerServiceError } from "@/src/services/managers/manager-service";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") {
    throw new ManagerServiceError("Admin access only", "FORBIDDEN", 403);
  }
}

/** POST /api/platform-admin/managers/[id]/reactivate — ADMIN only. Restores access under the manager's current permissions. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const manager = await managerService.reactivateManager(id);
    return apiResponse({ manager });
  } catch (error: any) {
    const status = error instanceof ManagerServiceError ? error.status : 500;
    return apiError(error.message, error.code || "ERROR", status);
  }
}
