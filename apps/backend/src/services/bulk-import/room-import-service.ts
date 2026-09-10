import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { propertyService } from "@/lib/services/property-service";
import type { RoomPlan } from "@/lib/services/bulk-import/room-plan";

const logger = getLogger("bulk-import-rooms");

export type RoomApplyResult = {
  created: number;
  updated: number;
  errors: Array<{ room_no: string; error: string }>;
};

type FloorRoom = { room_no: string; capacity: number; base_rent?: number; room_type?: string };

/** "Floor 2" / "Ground floor" — the name an owner recognises. */
function floorName(level: number): string {
  return level === 0 ? "Ground floor" : `Floor ${level}`;
}

/**
 * Creates and updates the rooms an import's Rooms sheet describes.
 *
 * ## Why this submits whole floors
 *
 * `propertyService.saveRoomsForFloor` takes *the floor as it should be*, not a
 * list of additions: any room on that floor missing from the list is retired
 * (`plan.deactivate`). Sending only the new rooms would therefore switch off
 * every room already on that floor — silently for an empty room, and as a
 * loud CONFLICT for an occupied one. So each affected floor is submitted with
 * its full contents: the rooms already there, carrying any edits from the
 * sheet, plus the new ones.
 *
 * For the same reason a floor is never split into chunks — each call is the
 * whole floor by definition.
 *
 * A room that belongs to no floor cannot be expressed this way, so its edits
 * are applied directly; nothing about it moves, only capacity and rent.
 */
export async function applyRoomPlan(
  plan: RoomPlan,
  ownerId: string,
  hostelId: string
): Promise<RoomApplyResult> {
  const result: RoomApplyResult = { created: 0, updated: 0, errors: [] };
  if (plan.create.length === 0 && plan.update.length === 0) return result;

  const [floors, existingRooms] = await Promise.all([
    prisma.floors.findMany({
      where: { hostel_id: hostelId },
      select: { id: true, name: true, sort_order: true },
    }),
    // Not filtered to active: the plan matched against every room the hostel
    // has, so an edit to a retired room would otherwise be dropped with no
    // write, no count and no error. saveRoomsForFloor revives it.
    prisma.rooms.findMany({
      where: { hostel_id: hostelId },
      select: {
        id: true,
        room_no: true,
        floor_id: true,
        capacity: true,
        base_rent: true,
        room_type: true,
      },
    }),
  ]);

  const editsById = new Map(plan.update.map((u) => [u.id, u.to]));
  const floorsBySortOrder = new Map<number, { id: string; name: string; sort_order: number }>();
  const floorsByName = new Map<string, { id: string; name: string; sort_order: number }>();
  for (const floor of floors) {
    floorsBySortOrder.set(Number(floor.sort_order ?? 0), floor as any);
    floorsByName.set(String(floor.name).trim().toLowerCase(), floor as any);
  }

  /** The floor a new room belongs on, creating it when the hostel has none. */
  async function resolveFloorId(level: number): Promise<string> {
    const existing = floorsBySortOrder.get(level) ?? floorsByName.get(floorName(level).toLowerCase());
    if (existing) return existing.id;

    const created = await propertyService.createFloor(ownerId, hostelId, {
      name: floorName(level),
      sort_order: level,
    });
    const record = { id: created.id, name: created.name, sort_order: level };
    floorsBySortOrder.set(level, record);
    floorsByName.set(record.name.trim().toLowerCase(), record);
    return created.id;
  }

  // Group the new rooms by the floor they will live on.
  const createsByFloor = new Map<string, typeof plan.create>();
  for (const room of plan.create) {
    try {
      const floorId = await resolveFloorId(Math.trunc(Number(room.floor ?? 0)));
      const bucket = createsByFloor.get(floorId) ?? [];
      bucket.push(room);
      createsByFloor.set(floorId, bucket);
    } catch (error: any) {
      result.errors.push({ room_no: room.room_no, error: String(error?.message || error) });
    }
  }

  // Floors that need saving: those gaining rooms, and those whose existing
  // rooms the owner edited.
  const touchedFloorIds = new Set<string>(createsByFloor.keys());
  for (const update of plan.update) {
    const room = existingRooms.find((r: any) => r.id === update.id);
    if (room?.floor_id) touchedFloorIds.add(room.floor_id);
  }

  for (const floorId of Array.from(touchedFloorIds)) {
    const onThisFloor = existingRooms.filter((r: any) => r.floor_id === floorId);
    const creates = createsByFloor.get(floorId) ?? [];

    // The floor as it should be: everything already on it (with edits
    // applied) plus everything being added to it. Omitting any of these
    // would retire them.
    const submitted: FloorRoom[] = [
      ...onThisFloor.map((room: any) => {
        const edit = editsById.get(room.id);
        return {
          room_no: room.room_no,
          capacity: edit?.capacity ?? room.capacity,
          base_rent: edit?.base_rent ?? (room.base_rent ?? undefined),
          room_type: room.room_type ?? undefined,
        };
      }),
      ...creates.map((room) => ({
        room_no: room.room_no.trim(),
        capacity: Number(room.capacity),
        base_rent: room.base_rent,
        room_type: room.sharing_type,
      })),
    ];

    try {
      await propertyService.saveRoomsForFloor(floorId, ownerId, submitted);
      result.created += creates.length;
      result.updated += onThisFloor.filter((r: any) => editsById.has(r.id)).length;
    } catch (error: any) {
      const message = String(error?.message || error);
      logger.error("bulk_import.floor_save_failed", { hostel_id: hostelId, floor_id: floorId, error: message });
      for (const room of [...creates.map((r) => r.room_no), ...onThisFloor.filter((r: any) => editsById.has(r.id)).map((r: any) => r.room_no)]) {
        result.errors.push({ room_no: room, error: message });
      }
    }
  }

  // Rooms attached to no floor: no floor to describe, so apply the edit
  // directly. Only capacity and rent change; nothing moves.
  const floorlessEdits = plan.update.filter((u) => {
    const room = existingRooms.find((r: any) => r.id === u.id);
    return room && !room.floor_id;
  });
  for (const edit of floorlessEdits) {
    try {
      await prisma.rooms.update({
        where: { id: edit.id },
        data: {
          ...(edit.to.capacity !== undefined ? { capacity: edit.to.capacity } : {}),
          ...(edit.to.base_rent !== undefined ? { base_rent: edit.to.base_rent } : {}),
          updated_at: new Date(),
        },
      });
      result.updated += 1;
    } catch (error: any) {
      result.errors.push({ room_no: edit.room_no, error: String(error?.message || error) });
    }
  }

  return result;
}
