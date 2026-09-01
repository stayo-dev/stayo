/**
 * Pure grouping/state logic behind the room-preference picker — the "choose a
 * floor, then tap a small square for the room you want" interaction used by
 * both the tenant's enquiry page and the owner's Invite Tenant wizard.
 *
 * Deliberately has no rendering: the two call sites render inside completely
 * different visual systems (Discover's hard-coded hex tokens vs. the owner
 * app's Tailwind theme tokens — see `discoverTheme.ts`), so each keeps its
 * own small presentational component. This is the one piece that actually is
 * identical between them, and the one piece worth sharing.
 */

export type SeatState = 'available' | 'selected' | 'unavailable';

export interface SeatGridRoom {
  id: string;
  roomNo: string;
  state: SeatState;
  /**
   * Beds in the room, and how many are free. `capacity` is 0 when the caller
   * didn't supply one — the tenant-facing enquiry picker doesn't, because a
   * prospective resident is choosing a room they like, not staffing it.
   */
  capacity: number;
  available: number;
  /** Beds taken right now: occupants plus any bed held by a live invitation. */
  used: number;
  /**
   * "3 free" / "1 free" / "Full" — the short form that fits on a room square,
   * or `null` when capacity is unknown and any count would be a guess.
   *
   * This is the number an owner is really scanning for. It was in the API
   * response all along and thrown away in the mapping, so "which rooms have
   * space" could only be answered by tapping rooms one at a time and watching
   * which ones refused.
   */
  occupancyLabel: string | null;
}

export interface SeatGridFloor {
  id: string;
  name: string;
  rooms: SeatGridRoom[];
}

export interface SeatGridSourceRoom {
  id: string;
  roomNo: string;
  floorId: string | null;
  floorName: string | null;
  /** Beds free on this room right now — 0 (or less) renders as unavailable. */
  available: number;
  /** Total beds. Optional: only the owner-facing picker has it, and shows it. */
  capacity?: number;
  /** Beds taken — occupants plus reservations. Derived from capacity when absent. */
  used?: number;
}

const UNASSIGNED_FLOOR_KEY = '__unassigned';

/**
 * Groups a hostel's rooms into floors for the picker, each room tagged
 * available/selected/unavailable. Floors keep the order rooms arrive in —
 * both call sites already fetch rooms pre-ordered by floor — and a room with
 * no `floorId` groups under a synthetic "Other" floor rather than being
 * dropped, so an unassigned room is still choosable.
 */
export function groupRoomsByFloor(
  rooms: SeatGridSourceRoom[],
  options: { selectedRoomId?: string | null } = {},
): SeatGridFloor[] {
  const floors = new Map<string, SeatGridFloor>();
  const order: string[] = [];

  for (const room of rooms) {
    const floorKey = room.floorId ?? UNASSIGNED_FLOOR_KEY;
    if (!floors.has(floorKey)) {
      floors.set(floorKey, {
        id: floorKey,
        name: room.floorName ?? 'Other',
        rooms: [],
      });
      order.push(floorKey);
    }

    const state: SeatState =
      room.id === options.selectedRoomId ? 'selected' : room.available > 0 ? 'available' : 'unavailable';

    const capacity = Math.max(0, Number(room.capacity ?? 0));
    const available = Math.max(0, Number(room.available ?? 0));
    // Trust an explicit `used` when given one — it counts held reservations,
    // which `capacity - available` would too, but only when both are present.
    const used = room.used !== undefined ? Math.max(0, Number(room.used)) : Math.max(0, capacity - available);

    floors.get(floorKey)!.rooms.push({
      id: room.id,
      roomNo: room.roomNo,
      state,
      capacity,
      available,
      used,
      occupancyLabel: occupancyLabel(capacity, available),
    });
  }

  return order.map((key) => floors.get(key) as SeatGridFloor);
}

/**
 * The count that goes on a room square. `null` when the caller supplied no
 * capacity, so the square shows only its number rather than inventing "0 free".
 */
export function occupancyLabel(capacity: number, available: number): string | null {
  if (!(capacity > 0)) return null;
  if (available <= 0) return 'Full';
  return `${available} free`;
}

/**
 * "3 beds · 1 free" — the longer form for the detail strip under the grid,
 * where there is room to say what the short label is counting.
 */
export function describeRoomOccupancy(capacity: number, available: number): string | null {
  if (!(capacity > 0)) return null;
  const beds = `${capacity} ${capacity === 1 ? 'bed' : 'beds'}`;
  return available <= 0 ? `${beds} · full` : `${beds} · ${available} free`;
}

/** The floor a given room belongs to, or null if the room isn't in this list. */
export function floorIdForRoom(rooms: SeatGridSourceRoom[], roomId: string): string | null {
  return rooms.find((room) => room.id === roomId)?.floorId ?? null;
}
