/**
 * Good first guesses for a new room or floor, so adding one is usually a
 * single tap.
 *
 * The owner adds rooms from the building itself (ADR-199): tapping "+" under
 * the Second floor should offer room 305 with the beds and rent its
 * neighbours have, not a blank form. And a new floor should be called
 * "Fourth floor" with rooms 401–405 — before this, the Add floor sheet
 * suggested "2th Floor" and numbered its rooms "Four-01".
 *
 * Every guess is editable; the server still refuses a duplicate number.
 *
 * PURE — runs under vitest's node environment.
 */
import { floorLevel } from './buildingModel';

const NUMBERED = /^(.*?)(\d+)$/;

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The next room number on a floor: one past the highest numbered room there,
 * keeping its prefix and zero padding (304 → 305, G04 → G05, A-9 → A-10).
 * An empty floor starts from its plate (4 → 401, G → G01). Never a number
 * the hostel already has.
 */
export function nextRoomNumber(floorNumbers: string[], hostelNumbers: string[], plate: string): string {
  const taken = new Set([...hostelNumbers, ...floorNumbers].map(norm));
  let best: { prefix: string; n: number; width: number } | null = null;
  for (const raw of floorNumbers) {
    const m = raw.trim().match(NUMBERED);
    if (!m) continue;
    const n = Number(m[2]);
    if (!best || n > best.n) best = { prefix: m[1]!, n, width: m[2]!.length };
  }
  const base = best ?? { prefix: plate, n: 0, width: 2 };
  const format = (k: number) => base.prefix + String(k).padStart(base.width, '0');
  let n = base.n + 1;
  while (taken.has(norm(format(n)))) n++;
  return format(n);
}

/** Room numbers for a floor created with `count` rooms: 401, 402… skipping any taken. */
export function newFloorRoomNumbers(plate: string, count: number, hostelNumbers: string[]): string[] {
  const made: string[] = [];
  for (let i = 0; i < count; i++) made.push(nextRoomNumber(made, [...hostelNumbers, ...made], plate));
  return made;
}

/** The value seen most often; the first one seen on a tie; null from nothing. */
export function mostCommon(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

interface RoomLike {
  number: string;
  capacity: number;
  rent: number;
}

/**
 * A new room on a floor, filled in from the rooms already there — then from
 * the hostel's usual room, then 4 beds. Rent is left blank rather than
 * guessed as ₹0 when nothing has one.
 */
export function suggestRoomDefaults(input: { floorRooms: RoomLike[]; hostelRooms: RoomLike[]; plate: string }): {
  roomNo: string;
  capacity: number;
  rent: number | null;
} {
  const { floorRooms, hostelRooms, plate } = input;
  const capacity = mostCommon(floorRooms.map((r) => r.capacity)) ?? mostCommon(hostelRooms.map((r) => r.capacity)) ?? 4;
  const rents = (rooms: RoomLike[]) => rooms.map((r) => r.rent).filter((v) => v > 0);
  const rent = mostCommon(rents(floorRooms)) ?? mostCommon(rents(hostelRooms)) ?? null;
  const roomNo = nextRoomNumber(
    floorRooms.map((r) => r.number),
    hostelRooms.map((r) => r.number),
    plate,
  );
  return { roomNo, capacity, rent };
}

const ORDINAL_NAMES = [
  'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth',
  'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth',
  'Eighteenth', 'Nineteenth', 'Twentieth',
];

function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}

type FloorStyle = { kind: 'word' } | { kind: 'nth' } | { kind: 'prefix'; prefix: string };

function styleOf(name: string, level: number): FloorStyle {
  const s = name.trim();
  if (level === 0 || new RegExp(`\\b(${ORDINAL_NAMES.join('|')})\\b`, 'i').test(s)) return { kind: 'word' };
  if (/\b\d+(st|nd|rd|th)\b/i.test(s)) return { kind: 'nth' };
  const prefixed = s.match(/^([a-z]+)\s*\d+$/i);
  return { kind: 'prefix', prefix: prefixed ? prefixed[1]! : 'Floor' };
}

function nameFor(style: FloorStyle, level: number): string {
  if (style.kind === 'word') return level >= 1 && level <= ORDINAL_NAMES.length ? `${ORDINAL_NAMES[level - 1]} floor` : `Floor ${level}`;
  if (style.kind === 'nth') return `${level}${ordinalSuffix(level)} floor`;
  return `${style.prefix} ${level}`;
}

/**
 * The name for the next floor up, in the owner's own style: after "Second
 * floor" comes "Third floor", after "2nd floor" "3rd floor", after "Floor 2"
 * "Floor 3". With nothing recognisable it counts on ("Floor 3" for two
 * floors), and it never offers a name the hostel already has.
 */
export function suggestFloorName(existing: string[]): string {
  if (existing.length === 0) return 'Ground floor';
  const taken = new Set(existing.map(norm));
  let top: { level: number; style: FloorStyle } | null = null;
  for (const name of existing) {
    const level = floorLevel(name);
    if (level == null) continue;
    if (!top || level > top.level) top = { level, style: styleOf(name, level) };
  }
  const style: FloorStyle = top?.style ?? { kind: 'prefix', prefix: 'Floor' };
  let level = top ? top.level + 1 : existing.length + 1;
  while (taken.has(norm(nameFor(style, level)))) level++;
  return nameFor(style, level);
}
