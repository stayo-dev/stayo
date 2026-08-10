export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { assertBodySize } from "@/lib/security/api-guard";
import { roomOrderService, RoomOrderError } from "@/lib/services/room-order-service";

/**
 * 🏠 PATCH /api/rooms/reorder
 *
 * Persists the owner's manual room order within one floor of the Rooms tab.
 * Body: `{ hostelId, floorId, order: ["<roomId>", ...] }` — `floorId` is
 * `null` for the "no floor assigned" bucket, otherwise the full ordered list
 * of that floor's active rooms.
 *
 * Access: Owner/Admin only, owner-scoped.
 */
export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const sizeError = assertBodySize(req);
    if (sizeError) return sizeError;

    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));

    if (!body?.hostelId || typeof body.hostelId !== "string") {
      return apiError("hostelId is required", "VALIDATION_ERROR", 400);
    }

    const floorId: string | null = body.floorId === undefined ? null : body.floorId;
    const result = await roomOrderService.reorder(scope.owner_id, body.hostelId, floorId, body?.order);

    return apiResponse(result);
  } catch (error: any) {
    if (error instanceof RoomOrderError) {
      const status = error.code === "FORBIDDEN" ? 403 : error.code === "STALE_ORDER" ? 409 : 400;
      return apiError(error.message, error.code, status);
    }
    console.error("Detailed API Error [rooms.reorder.PATCH]:", error);
    return apiError(error.message || "Failed to reorder rooms");
  }
}
