import { prisma } from "../db";
import { eventLog } from "./event-log-service";

/**
 * RoomOrderService
 *
 * Owns `rooms.sort_order` — the owner-controlled position of a room within its
 * floor on the Rooms tab. Mirrors HostelOrderService (`display_order`, ADR-042):
 * nullable, never backfilled, NULLs sort last then by room_no (see
 * PropertyService.getFloorsWithRooms).
 *
 * Reorder rewrites every room's position within the floor in one transaction,
 * for the same reason hostel reorder does: patching rows one at a time can't
 * express "move to position 2" without renumbering neighbours anyway, and two
 * concurrent single-row patches can interleave into an order nobody asked for.
 */

export class RoomOrderError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "RoomOrderError";
  }
}

export class RoomOrderService {
  /**
   * Persist a new order for every room on one floor of one hostel.
   *
   * `floorId: null` targets the "no floor assigned" bucket. `orderedRoomIds`
   * must be exactly that floor's active rooms — same members, no duplicates,
   * nothing missing, nothing foreign — otherwise the client's view is stale
   * and the positions it computed are meaningless.
   */
  async reorder(
    ownerId: string,
    hostelId: string,
    floorId: string | null,
    orderedRoomIds: string[]
  ): Promise<{ order: { id: string; sort_order: number }[] }> {
    if (!Array.isArray(orderedRoomIds) || orderedRoomIds.length === 0) {
      throw new RoomOrderError("VALIDATION_ERROR", "order must be a non-empty array of room ids");
    }

    const unique = new Set(orderedRoomIds);
    if (unique.size !== orderedRoomIds.length) {
      throw new RoomOrderError("VALIDATION_ERROR", "order contains duplicate room ids");
    }

    const hostel = await prisma.hostels.findUnique({ where: { id: hostelId }, select: { owner_id: true } });
    if (!hostel || hostel.owner_id !== ownerId) {
      throw new RoomOrderError("FORBIDDEN", "Hostel is not owned by the authenticated owner");
    }

    const owned = await prisma.rooms.findMany({
      where: { hostel_id: hostelId, floor_id: floorId, is_active: true },
      select: { id: true },
    });
    const ownedIds = new Set<string>(owned.map((r: { id: string }) => r.id));

    const foreign = orderedRoomIds.filter((id) => !ownedIds.has(id));
    if (foreign.length > 0) {
      await eventLog.log("HOSTEL_SCOPE_VIOLATION", ownerId, { room_ids: foreign, source: "room_reorder" });
      throw new RoomOrderError("FORBIDDEN", "One or more rooms are not on this floor");
    }

    const missing = Array.from(ownedIds).filter((id) => !unique.has(id));
    if (missing.length > 0) {
      throw new RoomOrderError(
        "STALE_ORDER",
        "order must include every room on this floor; refresh and try again"
      );
    }

    await prisma.$transaction(
      orderedRoomIds.map((id, index) =>
        prisma.rooms.update({
          where: { id },
          data: { sort_order: index, updated_at: new Date() },
        })
      )
    );

    return { order: orderedRoomIds.map((id, index) => ({ id, sort_order: index })) };
  }
}

export const roomOrderService = new RoomOrderService();
