/**
 * What saving a floor's rooms should actually do to the database.
 *
 * `POST /api/floors/:id/rooms` was create-only, which made the hostel builder's
 * Review screen a trap: it offers a pencil on every floor, and taking it led
 * back to a "Save floor" button that re-posted rooms which already existed,
 * so the owner was answered with `Room 101 already exists in this hostel` and
 * had no way forward. Pressing Back into a floor already saved did the same.
 * The endpoint now saves the floor as it currently stands — create what's new,
 * update what moved, retire what the owner removed.
 *
 * The decision is pure and lives here, separately from the writes, because it
 * is the part with all the rules in it — occupancy, cross-floor number
 * clashes, the `@@unique([hostel_id, room_no])` index — and this repo has no
 * provisioned test database, so logic that only exists inside a Prisma
 * transaction cannot be tested at all. Same reasoning as `floorBlocker` on the
 * frontend and `buildSettlementPlan` on this side.
 */

/** A room already in this hostel, as far as planning is concerned. */
export interface ExistingRoom {
  id: string;
  room_no: string;
  floor_id: string | null;
  is_active: boolean;
  capacity: number;
  /** Tenants currently living in it. Blocks removal and shrinking. */
  active_allocations: number;
}

/** A room the owner wants on this floor after saving. */
export interface DesiredRoom {
  room_no: string;
  capacity: number;
  base_rent?: number;
  room_type?: string;
}

export interface PlannedCreate {
  room_no: string;
  capacity: number;
  base_rent: number | null;
  room_type: string | null;
  sort_order: number;
}

export interface PlannedUpdate extends PlannedCreate {
  id: string;
  /** True when the row is being pulled onto this floor from somewhere else. */
  moved: boolean;
  /** True when a previously retired room is coming back. */
  reactivated: boolean;
}

export type FloorRoomPlan =
  | { ok: false; code: 'VALIDATION' | 'CONFLICT'; reason: string }
  | {
      ok: true;
      create: PlannedCreate[];
      update: PlannedUpdate[];
      /** Ids of rooms on this floor the owner has removed. */
      deactivate: string[];
    };

const normalise = (value: string) => value.trim();

/**
 * Decide the writes for saving `desired` as the complete contents of `floorId`.
 *
 * `existing` must contain every room in the hostel that either sits on this
 * floor **or** claims one of the requested numbers — including inactive ones.
 * Inactive rooms matter because the unique index covers them: a retired room
 * still owns its number, so re-adding that number has to revive the row rather
 * than insert a second one and hit a raw Postgres constraint error.
 */
export function planFloorRoomSave(
  floorId: string,
  desired: DesiredRoom[],
  existing: ExistingRoom[],
): FloorRoomPlan {
  const numbers = desired.map((room) => normalise(room.room_no));

  const blank = numbers.findIndex((no) => no.length === 0);
  if (blank >= 0) return { ok: false, code: 'VALIDATION', reason: `Room ${blank + 1} needs a number` };

  const repeated = numbers.find((no, i) => numbers.indexOf(no) !== i);
  if (repeated) return { ok: false, code: 'VALIDATION', reason: `Room ${repeated} is listed twice` };

  const byNumber = new Map(existing.map((room) => [room.room_no, room]));

  const create: PlannedCreate[] = [];
  const update: PlannedUpdate[] = [];

  for (let index = 0; index < desired.length; index += 1) {
    const room = desired[index];
    const room_no = numbers[index];
    const row: PlannedCreate = {
      room_no,
      capacity: room.capacity,
      base_rent: room.base_rent ?? null,
      room_type: room.room_type ?? null,
      sort_order: index,
    };

    const match = byNumber.get(room_no);
    if (!match) {
      create.push(row);
      continue;
    }

    // A live room on another floor genuinely is a clash — the owner has two
    // rooms claiming one number, and only they can say which is right.
    if (match.is_active && match.floor_id !== floorId) {
      return { ok: false, code: 'CONFLICT', reason: `Room ${room_no} already exists in this hostel` };
    }

    // Shrinking a room below the number of people in it would leave a tenant
    // allocated to a bed that no longer exists.
    if (match.active_allocations > room.capacity) {
      return {
        ok: false,
        code: 'VALIDATION',
        reason:
          `Room ${room_no} has ${match.active_allocations} ${match.active_allocations === 1 ? 'person' : 'people'} ` +
          `in it, so it cannot be set to ${room.capacity}-sharing`,
      };
    }

    update.push({
      ...row,
      id: match.id,
      moved: match.floor_id !== floorId,
      reactivated: !match.is_active,
    });
  }

  // Anything live on this floor the owner did not send back has been removed.
  const wanted = new Set(numbers);
  const dropped = existing.filter(
    (room) => room.floor_id === floorId && room.is_active && !wanted.has(room.room_no),
  );

  const occupied = dropped.find((room) => room.active_allocations > 0);
  if (occupied) {
    return {
      ok: false,
      code: 'VALIDATION',
      reason: `Room ${occupied.room_no} still has someone living in it — move them out before removing it`,
    };
  }

  return { ok: true, create, update, deactivate: dropped.map((room) => room.id) };
}
