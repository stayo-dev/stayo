/**
 * The Rooms tab as a building (ADR-199) — every decision it makes.
 *
 * Owners recognise the people in their hostel by face long before they
 * recall a room number, so the tab draws the hostel as it stands: top floor
 * on top, ground floor at the bottom, every room a tile of the faces that
 * live in it. This module decides what goes where — floor order and plate
 * labels, what each bed shows, the counts, search, the lens and what a screen
 * reader says — so the components only draw.
 *
 * PURE — no React, no DOM; runs under vitest's node environment.
 */
import type { RoomOccupant, RoomWithOccupants } from '../types';

/** The backend's bucket for rooms that belong to no floor. */
export const UNASSIGNED_FLOOR_ID = '__unassigned';

/** What one bed shows. Tenants first, then invites, then the free beds. */
export type BedSlot =
  | { kind: 'tenant'; key: string; tenantId: string | null; name: string; photoUrl: string | null; overdue: boolean }
  | { kind: 'invited'; key: string; tenantId: string | null; name: string | null }
  | { kind: 'free'; key: string };

/** One of the three numbers at the top, used as a filter. */
export type Lens = 'free' | 'overdue' | 'invited';
export type Emphasis = 'normal' | 'dim' | 'glow';

export interface SlotCounts {
  beds: number;
  tenants: number;
  free: number;
  invited: number;
  overdue: number;
}

const ORDINAL_WORDS = [
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
  'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth',
  'eighteenth', 'nineteenth', 'twentieth',
] as const;

/**
 * Which storey a floor name describes, or null when it names no storey
 * ("Annexe", "Terrace"). Ground is 0; "First floor", "1st floor", "Floor 1"
 * and "Level 1" are all 1.
 */
export function floorLevel(name: string): number | null {
  const s = String(name ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'g' || /\bground\b/.test(s)) return 0;
  for (let i = 0; i < ORDINAL_WORDS.length; i++) {
    if (new RegExp(`\\b${ORDINAL_WORDS[i]}\\b`).test(s)) return i + 1;
  }
  const digits = s.match(/\d+/);
  return digits ? Number(digits[0]) : null;
}

/** The short label on a floor's plate, like the buttons in a lift. */
export function floorPlate(name: string): string {
  const level = floorLevel(name);
  if (level === 0) return 'G';
  if (level != null) return String(level);
  const s = String(name ?? '').trim().toLowerCase();
  if (/\bbasement\b/.test(s)) return 'B';
  if (/\b(terrace|roof)\b/.test(s)) return 'T';
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return initials || '?';
}

/**
 * Floors as a building stands: the highest `order` on top. Rooms with no
 * floor are kept out of the stack and drawn beside it.
 */
export function stackFloors<F extends { id: string; order: number }>(floors: F[]): { stacked: F[]; unassigned: F | null } {
  const stacked = floors.filter((f) => f.id !== UNASSIGNED_FLOOR_ID).sort((a, b) => b.order - a.order);
  return { stacked, unassigned: floors.find((f) => f.id === UNASSIGNED_FLOOR_ID) ?? null };
}

function tenantSlot(o: RoomOccupant, key: string): BedSlot {
  return {
    kind: 'tenant',
    key,
    tenantId: o.tenant_id,
    name: o.name,
    photoUrl: o.photo_url ?? null,
    overdue: o.payment_status === 'OVERDUE',
  };
}

/**
 * What each bed in a room shows.
 *
 * `room.beds` carries the backend's counts (occupied, then reserved, then
 * vacant) and `room.occupants` the people; they are paired in order. When
 * the two disagree the people win — an extra tenant or invite is shown
 * rather than hidden, because a missing face is the one mistake this view
 * cannot make.
 */
export function roomBedSlots(room: RoomWithOccupants): BedSlot[] {
  const tenants = room.occupants.filter((o) => o.occupant_type !== 'INVITED');
  const invited = room.occupants.filter((o) => o.occupant_type === 'INVITED');
  const slots: BedSlot[] = [];
  let t = 0;
  let i = 0;
  for (const bed of room.beds) {
    const key = `${room.id}:${bed.id}`;
    if (bed.status === 'occupied') {
      const o = tenants[t++];
      slots.push(o ? tenantSlot(o, key) : { kind: 'tenant', key, tenantId: null, name: 'Occupied', photoUrl: null, overdue: false });
    } else if (bed.status === 'reserved') {
      const o = invited[i++];
      slots.push({ kind: 'invited', key, tenantId: o?.tenant_id ?? null, name: o?.name ?? null });
    } else {
      slots.push({ kind: 'free', key });
    }
  }
  const firstFree = slots.findIndex((s) => s.kind === 'free');
  const extras: BedSlot[] = [];
  for (; t < tenants.length; t++) extras.push(tenantSlot(tenants[t]!, `${room.id}:extra:${tenants[t]!.tenant_id}`));
  for (; i < invited.length; i++) {
    extras.push({ kind: 'invited', key: `${room.id}:extra:${invited[i]!.tenant_id}`, tenantId: invited[i]!.tenant_id, name: invited[i]!.name });
  }
  if (extras.length === 0) return slots;
  // Keep the order the tiles promise — people before free beds.
  const at = firstFree === -1 ? slots.length : firstFree;
  return [...slots.slice(0, at), ...extras, ...slots.slice(at)];
}

export function countSlots(slots: BedSlot[]): SlotCounts {
  const counts: SlotCounts = { beds: slots.length, tenants: 0, free: 0, invited: 0, overdue: 0 };
  for (const s of slots) {
    if (s.kind === 'tenant') {
      counts.tenants++;
      if (s.overdue) counts.overdue++;
    } else if (s.kind === 'invited') counts.invited++;
    else counts.free++;
  }
  return counts;
}

export function countRooms(rooms: RoomWithOccupants[]): SlotCounts {
  const total: SlotCounts = { beds: 0, tenants: 0, free: 0, invited: 0, overdue: 0 };
  for (const room of rooms) {
    const c = countSlots(roomBedSlots(room));
    total.beds += c.beds;
    total.tenants += c.tenants;
    total.free += c.free;
    total.invited += c.invited;
    total.overdue += c.overdue;
  }
  return total;
}

/** Face size inside a room tile, px. Big enough to recognise, small enough for four rooms across a phone. */
export const TILE_FACE_PX = 23;
const TILE_GAP_PX = 4;
/** The tile's own padding and border, both sides. */
const TILE_CHROME_PX = 10;

/** Faces per row inside a tile: two up to four beds, three up to nine, then four. */
export function tileColumns(capacity: number): 2 | 3 | 4 {
  if (capacity <= 4) return 2;
  if (capacity <= 9) return 3;
  return 4;
}

/**
 * The narrowest a tile may be, sized to the widest room on its floor so every
 * tile on a floor lines up. The grid wraps rather than shrink a face.
 */
export function tileMinWidthPx(maxCapacity: number): number {
  const cols = tileColumns(maxCapacity);
  return cols * TILE_FACE_PX + (cols - 1) * TILE_GAP_PX + TILE_CHROME_PX;
}

/** Search finds a room by its number or by anyone in it. */
export function roomMatches(room: RoomWithOccupants, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (room.number.toLowerCase().includes(q)) return true;
  return room.occupants.some((o) => o.name.toLowerCase().includes(q));
}

/** How a bed is drawn under the active lens: the ones it is about glow, the rest fade. */
export function slotEmphasis(slot: BedSlot, lens: Lens | null): Emphasis {
  if (!lens) return 'normal';
  const hit =
    lens === 'free' ? slot.kind === 'free' : lens === 'invited' ? slot.kind === 'invited' : slot.kind === 'tenant' && slot.overdue;
  return hit ? 'glow' : 'dim';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What a screen reader says for a room tile — the faces are decorative, so
 * this is the whole content: "Room 302: Arjun Reddy, overdue; Ravi Kumar,
 * invited; 2 free beds".
 */
export function roomAriaLabel(roomNumber: string, slots: BedSlot[]): string {
  const parts: string[] = [];
  let held = 0;
  let free = 0;
  for (const s of slots) {
    if (s.kind === 'tenant') parts.push(s.overdue ? `${s.name}, overdue` : s.name);
    else if (s.kind === 'invited') {
      if (s.name) parts.push(`${s.name}, invited`);
      else held++;
    } else free++;
  }
  if (held) parts.push(plural(held, 'bed held for an invite', 'beds held for invites'));
  if (free) parts.push(plural(free, 'free bed', 'free beds'));
  return parts.length ? `Room ${roomNumber}: ${parts.join('; ')}` : `Room ${roomNumber}`;
}
