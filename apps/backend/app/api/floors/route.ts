export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { propertyService } from "@/lib/services/property-service";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";

/**
 * 🏢 FLOORS — List & Create
 * GET  /api/floors?hostelId=X  — list floors with room/occupancy counts
 * POST /api/floors             — create a new floor
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  try {
    const scope = resolveOwnerScope(session);
    const { searchParams } = new URL(req.url);
    const hostelId = searchParams.get("hostelId") || undefined;

    if (!hostelId) return ApiResponse.error(ApiError.badRequest("hostelId is required"));

    const floors = await propertyService.getFloors(scope.owner_id, hostelId);
    return ApiResponse.success(floors);
  } catch (error: any) {
    if (error?.code === "FORBIDDEN") return ApiResponse.error(ApiError.forbidden(error.message));
    return ApiResponse.error(ApiError.internal("Failed to fetch floors", error));
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const { hostelId, name, sort_order } = body;

    if (!hostelId) return ApiResponse.error(ApiError.badRequest("hostelId is required"));
    if (!name || !String(name).trim()) return ApiResponse.error(ApiError.badRequest("name is required"));

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const floor = await propertyService.createFloor(scope.owner_id, hostelId, {
      name: String(name),
      sort_order: sort_order !== undefined ? Number(sort_order) : undefined,
    });

    return ApiResponse.success(floor, "Floor created", { status: 201 });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to create floor");
    if (msg.startsWith("NOT_FOUND:")) return ApiResponse.error(ApiError.notFound(msg.replace("NOT_FOUND:", "").trim()));
    return ApiResponse.error(ApiError.internal("Failed to create floor", error));
  }
}
