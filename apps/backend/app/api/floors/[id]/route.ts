export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { propertyService } from "@/lib/services/property-service";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";

/**
 * 🏢 FLOOR BY ID — Update & Delete
 * PATCH  /api/floors/[id]  — rename or reorder a floor
 * DELETE /api/floors/[id]  — delete if no rooms assigned
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));

    const updated = await propertyService.updateFloor(params.id, scope.owner_id, {
      name: body.name,
      sort_order: body.sort_order,
    });

    return ApiResponse.success(updated);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to update floor");
    if (msg.startsWith("NOT_FOUND:")) return ApiResponse.error(ApiError.notFound(msg.replace("NOT_FOUND:", "").trim()));
    return ApiResponse.error(ApiError.internal("Failed to update floor", error));
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  try {
    const scope = resolveOwnerScope(session);
    await propertyService.deleteFloor(params.id, scope.owner_id);
    return new Response(null, { status: 204 });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to delete floor");
    if (msg.startsWith("NOT_FOUND:"))   return ApiResponse.error(ApiError.notFound(msg.replace("NOT_FOUND:", "").trim()));
    if (msg.startsWith("VALIDATION:"))  return ApiResponse.error(ApiError.badRequest(msg.replace("VALIDATION:", "").trim()));
    return ApiResponse.error(ApiError.internal("Failed to delete floor", error));
  }
}
