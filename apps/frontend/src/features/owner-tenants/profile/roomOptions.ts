/**
 * Which rooms an owner may move a tenant into, from `GET /api/rooms`.
 *
 * Room change previously had no working UI at all — the one path asked the
 * owner to type a room UUID into a free-text field which the change-management
 * facade then discarded, because `room_id` is not a `tenant_profile` field.
 * This list replaces that: every entry is a room `POST /api/allocations/shift`
 * should accept, so tapping one is a decision, not a gamble.
 *
 * The vacancy rule mirrors the one `TransferRoomSheet` has been using against
 * the same endpoint, lifted here so it is tested rather than trusted.
 */

export interface RoomOption {
  id: string;
  roomNo: string;
  floor: string | null;
  capacity: number;
  free: number;
  baseRent: number | null;
  /** True when moving here would put the tenant's rent out of step with the room's. */
  rentDiffers: boolean;
}

export interface RoomOptionsContext {
  /** The tenant's current room, excluded from the list — moving there is a no-op. */
  currentRoomId: string | null | undefined;
  /** Used only to flag a mismatch; rent is never changed by a room move. */
  currentRent?: number | null;
}

const UNAVAILABLE_STATUSES = new Set(['MAINTENANCE', 'BLOCKED']);

/**
 * Beds free in a room. Prefers the server's own `vacant_count`; otherwise
 * derives it, tolerating either name the rooms endpoints use for occupancy.
 */
function freeBeds(room: Record<string, any>): number {
  const capacity = Number(room.capacity ?? 1);
  if (room.vacant_count != null) return Math.max(Number(room.vacant_count), 0);
  const occupied = Number(room.used_count ?? room.occupied_count ?? 0);
  return Math.max(capacity - occupied, 0);
}

/** Sorts "19" before "110" — a room list read lexically looks shuffled to an owner. */
function compareRoomNo(a: string, b: string): number {
  const numeric = (v: string) => {
    const digits = v.replace(/\D/g, '');
    return digits ? Number(digits) : Number.NaN;
  };
  const left = numeric(a);
  const right = numeric(b);
  if (!Number.isNaN(left) && !Number.isNaN(right) && left !== right) return left - right;
  return a.localeCompare(b);
}

function compareFloor(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareRoomNo(a, b);
}

export function toRoomOptions(
  rooms: unknown,
  { currentRoomId, currentRent }: RoomOptionsContext,
): RoomOption[] {
  if (!Array.isArray(rooms)) return [];

  const options: RoomOption[] = [];

  for (const raw of rooms) {
    if (!raw || typeof raw !== 'object') continue;
    const room = raw as Record<string, any>;

    const id = String(room.id ?? '');
    if (!id || id === String(currentRoomId ?? '')) continue;
    if (UNAVAILABLE_STATUSES.has(String(room.status ?? '').toUpperCase())) continue;

    const free = freeBeds(room);
    if (free <= 0) continue;

    const baseRent = room.base_rent == null ? null : Number(room.base_rent);
    const rentDiffers =
      baseRent != null && currentRent != null && Number(currentRent) !== baseRent;

    options.push({
      id,
      roomNo: String(room.room_no ?? ''),
      floor: room.floor == null ? null : String(room.floor),
      capacity: Number(room.capacity ?? 1),
      free,
      baseRent,
      rentDiffers,
    });
  }

  return options.sort(
    (a, b) => compareFloor(a.floor, b.floor) || compareRoomNo(a.roomNo, b.roomNo),
  );
}
