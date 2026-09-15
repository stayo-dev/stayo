export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { assertOwnerSubscriptionActive, billingErrorResponse } from "@/src/services/platform-billing/subscription-http";
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
import { planRoomRemoval } from "@/lib/services/property/room-removal-plan";
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
    await assertOwnerSubscriptionActive(scope.owner_id, "rooms.id");
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
    const billing = billingErrorResponse(error);
    if (billing) return billing;
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
    await assertOwnerSubscriptionActive(scope.owner_id, "rooms.id");
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

    // Everything attached to the room, live and historical. The live counts
    // decide whether removal is allowed at all; the totals decide whether the
    // row can go or has to be retired. See `planRoomRemoval` (ADR-207).
    const [activeAllocations, activeInvitationReservations, allocations, invitations, invitationReservations, reservations] =
      await Promise.all([
        prisma.roomAllocation.count({ where: { room_id: params.id, is_active: true, end_date: null } }),
        prisma.tenant_invitation_reservations.count({ where: { room_id: params.id, status: "ACTIVE" } }),
        prisma.roomAllocation.count({ where: { room_id: params.id } }),
        prisma.tenant_invitations.count({ where: { room_id: params.id } }),
        prisma.tenant_invitation_reservations.count({ where: { room_id: params.id } }),
        prisma.room_reservations.count({ where: { room_id: params.id } }),
      ]);

    const plan = planRoomRemoval({
      activeAllocations,
      activeInvitationReservations,
      allocations,
      invitations,
      invitationReservations,
      reservations,
    });

    if (plan.action === "refuse") {
      return apiError(plan.reason, "VALIDATION_ERROR", 400);
    }

    if (plan.action === "purge") {
      // `room_activity_logs` has a RESTRICT foreign key and no reader anywhere
      // in the codebase, so it is cleared with the room rather than allowed to
      // block it. One transaction: the room never outlives its logs.
      await prisma.$transaction(async (tx: any) => {
        await tx.room_activity_logs.deleteMany({ where: { room_id: params.id } });
        await tx.rooms.delete({ where: { id: params.id } });
      });
    } else {
      // Retired, not deleted: `GET /api/rooms` filters on `is_active`, so the
      // room leaves the building while its allocations, obligations and
      // receipts stay attached to it.
      await prisma.rooms.update({
        where: { id: params.id },
        data: { is_active: false, updated_at: new Date() },
      });
    }

    await eventSystem.trigger("room_deleted", {
      room_id: params.id,
      room_no: existing.room_no,
      hostel_id: existing.hostel_id,
      owner_id: scope.owner_id,
      user_id: scope.actor_id,
      retained: plan.action === "retire",
    }).catch((e: any) => console.error("Failed to trigger room_deleted event:", e));

    return new Response(null, { status: 204 });
  } catch (error: any) {
    const billing = billingErrorResponse(error);
    if (billing) return billing;
    // Never hand a raw Prisma message to the owner — a leaked
    // "Invalid `prisma.rooms.delete()` invocation" is exactly what this route
    // used to show when a RESTRICT foreign key fired.
    console.error("Detailed API Error [rooms.DELETE]:", error);
    return apiError("Could not delete this room. Please try again.", "DELETE_ERROR", 500);
  }
}
