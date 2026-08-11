/**
 * The hostel builder's model of a building under construction.
 *
 * The onboarding wizard this replaces described a whole property with four
 * numbers — `floors`, `roomsPerFloor`, `bedsPerRoom`, one `monthlyRent` — and
 * multiplied them into a uniform grid. That cannot express the ordinary case:
 * a ground floor of three 4-sharing rooms and one 2-sharing room, each at its
 * own rent. Here a floor owns an explicit list of rooms, and a floor-level
 * default is only the starting point for the rooms it generates.
 *
 * Rent is a *default*, never a price. `rooms.base_rent` prefills the invite
 * wizard (`auto_fill_room_rent`) and the owner freely overrides it per tenant
 * (`allow_override`); the binding figure is `tenants.monthly_rent`. Nothing
 * here should be presented as what a tenant will pay.
 */

export type NumberingPattern = 'NUMERIC' | 'FLOOR_PREFIX' | 'BLOCK';

export interface DraftRoom {
  /** Stable local key; rooms only get server ids once the floor is saved. */
  key: string;
  roomNo: string;
  capacity: number;
  rent: number | null;
  /**
   * The owner hand-edited this room, so changing the floor's defaults must
   * leave it alone. Without this, setting one room to 2-sharing and then
   * nudging the floor's rent would silently wipe that decision.
   */
  customised: boolean;
}

export interface DraftFloor {
  /** Server floor id — floors are created before their rooms. */
  id: string;
  name: string;
  defaultCapacity: number;
  defaultRent: number | null;
  rooms: DraftRoom[];
  /** True once this floor's rooms exist server-side. */
  saved: boolean;
}

const ORDINALS = [
  'Ground floor',
  'First floor',
  'Second floor',
  'Third floor',
  'Fourth floor',
  'Fifth floor',
  'Sixth floor',
  'Seventh floor',
  'Eighth floor',
  'Ninth floor',
];

export function defaultFloorName(index: number): string {
  return ORDINALS[index] ?? `Floor ${index}`;
}

// ── Room numbering ─────────────────────────────────────────────────────────

const BLOCK_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * The number for one room, given its floor and position.
 *
 * Onboarding hardcoded `${floor}${nn}` — 101…110, 201…210 — with no way to
 * express the `G-01` and `A-1` schemes hostels actually use.
 */
export function roomNumberFor(pattern: NumberingPattern, floorIndex: number, position: number): string {
  const seq = position + 1;
  switch (pattern) {
    case 'FLOOR_PREFIX': {
      const prefix = floorIndex === 0 ? 'G' : String(floorIndex);
      return `${prefix}-${String(seq).padStart(2, '0')}`;
    }
    case 'BLOCK': {
      const letter = BLOCK_LETTERS[floorIndex] ?? BLOCK_LETTERS[BLOCK_LETTERS.length - 1];
      return `${letter}-${seq}`;
    }
    case 'NUMERIC':
    default:
      return `${floorIndex + 1}${String(seq).padStart(2, '0')}`;
  }
}

/** A short sample of a pattern, for the picker. */
export function previewNumbering(pattern: NumberingPattern, floorIndex = 0): string {
  return [0, 1]
    .map((position) => roomNumberFor(pattern, floorIndex, position))
    .join(', ')
    .concat('…');
}

// ── Rent memory ────────────────────────────────────────────────────────────

/** Remembered rent per sharing size, e.g. { 2: 9000, 4: 6000 }. */
export type RentMemory = Record<number, number>;

/**
 * Owners price by sharing size, not by room. Once they have said a 2-sharing
 * room is ₹9,000, every later 2-sharing room should start there rather than
 * at whatever the current floor default happens to be — which is the single
 * biggest source of repeated typing in a mixed building.
 */
export function rememberRent(memory: RentMemory, capacity: number, rent: number | null): RentMemory {
  if (rent === null || !Number.isFinite(rent) || rent <= 0) return memory;
  return { ...memory, [capacity]: rent };
}

export function recallRent(memory: RentMemory, capacity: number, fallback: number | null): number | null {
  return memory[capacity] ?? fallback;
}

// ── Building a floor's rooms ───────────────────────────────────────────────

let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `r${keyCounter}`;
}

/** Reset between tests so keys are predictable. */
export function __resetRoomKeys() {
  keyCounter = 0;
}

/**
 * Regenerate a floor's room list for a new count, preserving what the owner
 * already decided.
 *
 * Rooms that survive the resize keep their identity — including hand-edits.
 * Shrinking drops from the end; growing appends rooms built from the floor
 * default (with any remembered rent for that sharing size).
 */
export function resizeFloorRooms(
  floor: DraftFloor,
  count: number,
  options: { pattern: NumberingPattern; floorIndex: number; rentMemory?: RentMemory },
): DraftRoom[] {
  const { pattern, floorIndex, rentMemory = {} } = options;
  const target = Math.max(0, Math.floor(count));
  const kept = floor.rooms.slice(0, target);

  const added = Array.from({ length: Math.max(0, target - kept.length) }, (_, i) => {
    const position = kept.length + i;
    return {
      key: nextKey(),
      roomNo: roomNumberFor(pattern, floorIndex, position),
      capacity: floor.defaultCapacity,
      rent: recallRent(rentMemory, floor.defaultCapacity, floor.defaultRent),
      customised: false,
    };
  });

  return [...kept, ...added];
}

/**
 * Apply a change to the floor's defaults.
 *
 * Only rooms the owner has not touched follow the default — a room they
 * explicitly set to 2-sharing at ₹9,000 stays that way.
 */
export function applyFloorDefaults(
  floor: DraftFloor,
  defaults: { capacity?: number; rent?: number | null },
  rentMemory: RentMemory = {},
): DraftFloor {
  const defaultCapacity = defaults.capacity ?? floor.defaultCapacity;
  const defaultRent =
    defaults.rent !== undefined
      ? defaults.rent
      : defaults.capacity !== undefined
        // Switching the floor's sharing size pulls in the rent already used
        // for that size, rather than leaving the previous size's price.
        ? recallRent(rentMemory, defaultCapacity, floor.defaultRent)
        : floor.defaultRent;

  return {
    ...floor,
    defaultCapacity,
    defaultRent,
    rooms: floor.rooms.map((room) =>
      room.customised ? room : { ...room, capacity: defaultCapacity, rent: defaultRent },
    ),
  };
}

/** Edit one room. Marks it customised so floor defaults stop overwriting it. */
export function editRoom(
  floor: DraftFloor,
  key: string,
  patch: Partial<Pick<DraftRoom, 'roomNo' | 'capacity' | 'rent'>>,
): DraftFloor {
  return {
    ...floor,
    rooms: floor.rooms.map((room) => (room.key === key ? { ...room, ...patch, customised: true } : room)),
  };
}

/**
 * "Floor 1: same as this" — copy a finished floor's shape onto the next one.
 *
 * Room *numbers* are regenerated for the new floor (a clone of the ground
 * floor must not produce a second room 101), but every room's sharing size
 * and rent carries over, including per-room overrides. Most buildings repeat
 * with exceptions, so this is the common path, not a shortcut.
 */
export function cloneFloorShape(
  source: DraftFloor,
  target: DraftFloor,
  options: { pattern: NumberingPattern; floorIndex: number },
): DraftFloor {
  return {
    ...target,
    defaultCapacity: source.defaultCapacity,
    defaultRent: source.defaultRent,
    rooms: source.rooms.map((room, position) => ({
      key: nextKey(),
      roomNo: roomNumberFor(options.pattern, options.floorIndex, position),
      capacity: room.capacity,
      rent: room.rent,
      customised: room.customised,
    })),
  };
}

// ── Tallies ────────────────────────────────────────────────────────────────

export interface Tally {
  rooms: number;
  beds: number;
}

/**
 * Rooms and beds only — deliberately no monthly total.
 *
 * A revenue figure derived from `base_rent` would be fiction: it is an invite
 * default, tenants in one room routinely pay different rents, and no bed is
 * occupied yet. This codebase has repeatedly been burned by plausible numbers
 * presented as real.
 */
export function floorTally(floor: DraftFloor): Tally {
  return {
    rooms: floor.rooms.length,
    beds: floor.rooms.reduce((sum, room) => sum + (room.capacity || 0), 0),
  };
}

export function buildingTally(floors: DraftFloor[]): Tally {
  return floors.reduce<Tally>(
    (acc, floor) => {
      const tally = floorTally(floor);
      return { rooms: acc.rooms + tally.rooms, beds: acc.beds + tally.beds };
    },
    { rooms: 0, beds: 0 },
  );
}

// ── Progress ───────────────────────────────────────────────────────────────

export interface BuildProgress {
  floorsDone: number;
  floorsTotal: number;
  /** Index of the next floor needing rooms, or null when finished. */
  nextFloorIndex: number | null;
  isComplete: boolean;
  /** One line for the home screen, e.g. "Ground floor done · 3 to go". */
  summary: string;
}

/**
 * How far a build has got.
 *
 * Derived from the floors themselves — a floor with no rooms is a floor still
 * to do — rather than stored in a new column. That keeps a resumed build
 * honest even if the owner adds or deletes floors from the Rooms tab in
 * between.
 */
export function buildProgress(floors: Array<{ name: string; roomCount: number }>): BuildProgress {
  const floorsTotal = floors.length;
  const doneIndexes = floors.map((floor, index) => (floor.roomCount > 0 ? index : -1)).filter((i) => i >= 0);
  const floorsDone = doneIndexes.length;
  const nextIndex = floors.findIndex((floor) => floor.roomCount === 0);
  const isComplete = floorsTotal > 0 && nextIndex === -1;

  let summary: string;
  if (floorsTotal === 0) {
    summary = 'No floors yet';
  } else if (isComplete) {
    summary = `${floorsTotal} ${floorsTotal === 1 ? 'floor' : 'floors'} set up`;
  } else if (floorsDone === 0) {
    summary = `${floorsTotal} ${floorsTotal === 1 ? 'floor' : 'floors'} to set up`;
  } else {
    const remaining = floorsTotal - floorsDone;
    summary = `${floors[doneIndexes[doneIndexes.length - 1]].name} done · ${remaining} to go`;
  }

  return {
    floorsDone,
    floorsTotal,
    nextFloorIndex: isComplete ? null : nextIndex === -1 ? null : nextIndex,
    isComplete,
    summary,
  };
}

// ── Server payload ─────────────────────────────────────────────────────────

/** What `POST /api/floors/:id/rooms` expects for one floor. */
export function toRoomsPayload(floor: DraftFloor): Array<{
  room_no: string;
  capacity: number;
  base_rent?: number;
  room_type?: string;
}> {
  return floor.rooms.map((room) => ({
    room_no: room.roomNo.trim(),
    capacity: room.capacity,
    ...(room.rent !== null && room.rent > 0 ? { base_rent: room.rent } : {}),
    room_type: `${room.capacity}-sharing`,
  }));
}

/** Why this floor cannot be saved yet, or null when it is ready. */
export function floorBlocker(floor: DraftFloor): string | null {
  if (floor.rooms.length === 0) return 'Add at least one room';
  const blank = floor.rooms.find((room) => !room.roomNo.trim());
  if (blank) return 'Every room needs a number';
  const numbers = floor.rooms.map((room) => room.roomNo.trim().toLowerCase());
  const duplicate = numbers.find((no, i) => numbers.indexOf(no) !== i);
  if (duplicate) return `Room ${duplicate} is used twice on this floor`;
  const noCapacity = floor.rooms.find((room) => !(room.capacity > 0));
  if (noCapacity) return `Room ${noCapacity.roomNo} needs a sharing size`;
  return null;
}
