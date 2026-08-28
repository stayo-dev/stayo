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

    floors.get(floorKey)!.rooms.push({ id: room.id, roomNo: room.roomNo, state });
  }

  return order.map((key) => floors.get(key) as SeatGridFloor);
}

/** The floor a given room belongs to, or null if the room isn't in this list. */
export function floorIdForRoom(rooms: SeatGridSourceRoom[], roomId: string): string | null {
  return rooms.find((room) => room.id === roomId)?.floorId ?? null;
}
