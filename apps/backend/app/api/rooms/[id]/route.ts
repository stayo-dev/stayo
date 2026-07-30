export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";


/**
 * 🏠 ROOM BY ID — Get, Update, Delete
 * GET    /api/rooms/[id]
 * PUT    /api/rooms/[id]
 * DELETE /api/rooms/[id]
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const room = await prisma.rooms.findUnique({
      where: { id: params.id },
      include: { hostels: { select: { owner_id: true } } },
    });

    if (!room || room.hostels.owner_id !== scope.owner_id) return apiError("Room not found", "NOT_FOUND", 404);
    return apiResponse(room);
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch room");
  }
}

import { propertyService } from "@/lib/services/property-service";
import { eventSystem } from "@/lib/events";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json();

    const updatedRoom = await propertyService.updateRoom(
      params.id,
      body,
      scope.owner_id
    );

    // Broadcast Server-Sent Event so owner dashboards refresh automatically
    await eventSystem.trigger("room_updated", {
      room_id: params.id,
      room_no: updatedRoom.room_no,
      hostel_id: updatedRoom.hostel_id,
      owner_id: scope.owner_id,
      user_id: scope.actor_id,
    });

    return apiResponse(updatedRoom);
  } catch (error: any) {
    const rawMessage = String(error?.message || "Failed to update room");
    const [maybeCode, ...rest] = rawMessage.split(":");
    const normalizedCode = maybeCode?.trim();
    const normalizedMessage = rest.length > 0 ? rest.join(":").trim() : rawMessage;

    const statusMap: Record<string, number> = {
      VALIDATION: 400,
      NOT_FOUND: 404,
      FORBIDDEN: 403
    };

    const status = statusMap[normalizedCode] || 500;
    return apiError(normalizedMessage, normalizedCode || "UPDATE_ERROR", status);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    // Verify ownership
    const existing = await prisma.rooms.findUnique({
      where: { id: params.id },
      include: { hostels: { select: { status: true } } },
    });
    if (!existing) return apiError("Room not found", "NOT_FOUND", 404);
    const ownerRoom = await prisma.rooms.findUnique({
      where: { id: params.id },
      include: { hostels: { select: { owner_id: true } } },
    });
    if (!ownerRoom || ownerRoom.hostels.owner_id !== scope.owner_id) return apiError("Room not found", "NOT_FOUND", 404);
    if (existing.hostels.status === "ARCHIVED") {
      return apiError("Cannot perform operational actions on an archived hostel", "VALIDATION_ERROR", 400);
    }
    if (existing.hostels.status === "INACTIVE") {
      return apiError("Cannot perform operational actions on an inactive hostel", "VALIDATION_ERROR", 400);
    }

    // Check for active allocations
    const activeAllocations = await prisma.roomAllocation.count({
      where: { room_id: params.id, is_active: true, end_date: null },
    });
    if (activeAllocations > 0) {
      return apiError("Cannot delete room with active tenants", "VALIDATION_ERROR", 400);
    }
    const activeReservations = await prisma.tenant_invitation_reservations.count({
      where: { room_id: params.id, status: "ACTIVE" },
    });
    if (activeReservations > 0) {
      return apiError("Cannot delete room with active invitation reservations", "VALIDATION_ERROR", 400);
    }

    await prisma.rooms.delete({ where: { id: params.id } });

    await eventSystem.trigger("room_deleted", {
      room_id: params.id,
      room_no: existing.room_no,
      hostel_id: existing.hostel_id,
      owner_id: scope.owner_id,
      user_id: scope.actor_id,
    }).catch((e: any) => console.error("Failed to trigger room_deleted event:", e));

    return new Response(null, { status: 204 });
  } catch (error: any) {
    return apiError(error.message || "Failed to delete room");
  }
}
