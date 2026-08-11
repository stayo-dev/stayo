export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { RoomBulkCreateSchema } from "@/lib/validators";
import { propertyService } from "@/lib/services/property-service";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { assertBodySize } from "@/lib/security/api-guard";

/**
 * 🏢 FLOOR ROOMS — Bulk create
 * POST /api/floors/[id]/rooms — create a whole floor's rooms in one request
 *
 * Exists for the hostel builder, which fills one floor at a time. Posting a
 * floor of 10 rooms one at a time was 10 requests and 10 chances to leave a
 * floor half-built; this is one request and one transaction.
 *
 * Every room is fully specified (`room_no`, `capacity`, its own `base_rent`)
 * because real floors mix sharing sizes and prices — the uniform
 * `rooms_per_floor` × `beds_per_room` × one-rent grid in
 * `POST /api/owner/hostels/provision` cannot express that.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  try {
    const sizeError = assertBodySize(req);
    if (sizeError) return sizeError;

    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));

    const validated = RoomBulkCreateSchema.safeParse(body);
    if (!validated.success) {
      return ApiResponse.error(
        ApiError.validationError("Validation error", { issues: validated.error.errors }),
      );
    }

    const rooms = await propertyService.createRoomsForFloor(
      params.id,
      scope.owner_id,
      validated.data.rooms,
    );

    return ApiResponse.success({ rooms, rooms_created: rooms.length }, undefined, { status: 201 });
  } catch (error: any) {
    const message = typeof error?.message === "string" ? error.message : String(error);
    if (message.startsWith("NOT_FOUND")) {
      return ApiResponse.error(ApiError.notFound(message.split(": ")[1] ?? message));
    }
    if (message.startsWith("CONFLICT")) {
      return ApiResponse.error(ApiError.conflict(message.split(": ")[1] ?? message));
    }
    if (message.startsWith("HOSTEL_ARCHIVED") || message.startsWith("FORBIDDEN")) {
      return ApiResponse.error(ApiError.forbidden(message.split(": ")[1] ?? message));
    }
    if (message.startsWith("VALIDATION")) {
      return ApiResponse.error(ApiError.validationError(message.split(": ")[1] ?? message));
    }
    console.error(`[floors.rooms.POST] Failed for floor ${params.id}:`, error);
    return ApiResponse.error(ApiError.internal("Could not create rooms"));
  }
}
