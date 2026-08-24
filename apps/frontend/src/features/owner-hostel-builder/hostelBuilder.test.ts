import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyFloorDefaults,
  buildProgress,
  buildingTally,
  cloneFloorShape,
  defaultFloorName,
  editRoom,
  floorBlocker,
  floorTally,
  previewNumbering,
  recallRent,
  renumberBuilding,
  renumberFloor,
  rememberRent,
  resizeFloorRooms,
  roomNumberFor,
  toRoomsPayload,
  __resetRoomKeys,
  type DraftFloor,
} from './hostelBuilder';

beforeEach(() => __resetRoomKeys());

const floor = (over: Partial<DraftFloor> = {}): DraftFloor => ({
  id: 'floor-1',
  name: 'Ground floor',
  defaultCapacity: 4,
  defaultRent: 6000,
  rooms: [],
  saved: false,
  ...over,
});

describe('defaultFloorName', () => {
  it('names the first floor Ground, not Floor 0', () => {
    expect(defaultFloorName(0)).toBe('Ground floor');
    expect(defaultFloorName(1)).toBe('First floor');
  });

  it('falls back for buildings taller than the ordinal list', () => {
    expect(defaultFloorName(12)).toBe('Floor 12');
  });
});

describe('roomNumberFor', () => {
  it('numbers by floor, matching what the old provisioning produced', () => {
    expect(roomNumberFor('NUMERIC', 0, 0)).toBe('101');
    expect(roomNumberFor('NUMERIC', 0, 9)).toBe('110');
    expect(roomNumberFor('NUMERIC', 1, 0)).toBe('201');
  });

  it('supports a ground-floor prefix scheme', () => {
    expect(roomNumberFor('FLOOR_PREFIX', 0, 0)).toBe('G-01');
    expect(roomNumberFor('FLOOR_PREFIX', 1, 2)).toBe('1-03');
  });

  it('supports block lettering', () => {
    expect(roomNumberFor('BLOCK', 0, 0)).toBe('A-1');
    expect(roomNumberFor('BLOCK', 2, 3)).toBe('C-4');
  });

  it('shows a sample of each pattern for the picker', () => {
    expect(previewNumbering('NUMERIC')).toBe('101, 102…');
    expect(previewNumbering('FLOOR_PREFIX')).toBe('G-01, G-02…');
  });
});

describe('resizeFloorRooms', () => {
  it('generates rooms from the floor default', () => {
    const rooms = resizeFloorRooms(floor(), 4, { pattern: 'NUMERIC', floorIndex: 0 });
    expect(rooms.map((r) => r.roomNo)).toEqual(['101', '102', '103', '104']);
    expect(rooms.every((r) => r.capacity === 4 && r.rent === 6000)).toBe(true);
    expect(rooms.every((r) => r.customised === false)).toBe(true);
  });

  it('prefers a remembered rent for the default sharing size', () => {
    const rooms = resizeFloorRooms(floor({ defaultCapacity: 2, defaultRent: null }), 1, {
      pattern: 'NUMERIC',
      floorIndex: 0,
      rentMemory: { 2: 9000 },
    });
    expect(rooms[0].rent).toBe(9000);
  });

  it('keeps existing rooms — and their edits — when growing', () => {
    let f = floor({ rooms: resizeFloorRooms(floor(), 2, { pattern: 'NUMERIC', floorIndex: 0 }) });
    f = editRoom(f, f.rooms[1].key, { capacity: 2, rent: 9000 });

    const grown = resizeFloorRooms(f, 4, { pattern: 'NUMERIC', floorIndex: 0 });
    expect(grown).toHaveLength(4);
    expect(grown[1]).toMatchObject({ roomNo: '102', capacity: 2, rent: 9000, customised: true });
    expect(grown[3].roomNo).toBe('104');
  });

  it('drops from the end when shrinking', () => {
    const f = floor({ rooms: resizeFloorRooms(floor(), 4, { pattern: 'NUMERIC', floorIndex: 0 }) });
    const shrunk = resizeFloorRooms(f, 2, { pattern: 'NUMERIC', floorIndex: 0 });
    expect(shrunk.map((r) => r.roomNo)).toEqual(['101', '102']);
  });

  it('handles being emptied', () => {
    const f = floor({ rooms: resizeFloorRooms(floor(), 3, { pattern: 'NUMERIC', floorIndex: 0 }) });
    expect(resizeFloorRooms(f, 0, { pattern: 'NUMERIC', floorIndex: 0 })).toEqual([]);
  });
});

describe('applyFloorDefaults', () => {
  it('updates untouched rooms only', () => {
    let f = floor({ rooms: resizeFloorRooms(floor(), 3, { pattern: 'NUMERIC', floorIndex: 0 }) });
    f = editRoom(f, f.rooms[2].key, { capacity: 2, rent: 9000 });

    const updated = applyFloorDefaults(f, { rent: 6500 });

    expect(updated.rooms[0].rent).toBe(6500);
    expect(updated.rooms[1].rent).toBe(6500);
    // The hand-edited 2-sharing room is left exactly as the owner set it.
    expect(updated.rooms[2]).toMatchObject({ capacity: 2, rent: 9000 });
  });

  it('pulls in the remembered rent when the floor changes sharing size', () => {
    const f = floor({ rooms: resizeFloorRooms(floor(), 2, { pattern: 'NUMERIC', floorIndex: 0 }) });
    const updated = applyFloorDefaults(f, { capacity: 2 }, { 2: 9000 });

    expect(updated.defaultCapacity).toBe(2);
    expect(updated.defaultRent).toBe(9000);
    expect(updated.rooms.every((r) => r.capacity === 2 && r.rent === 9000)).toBe(true);
  });

  it('keeps the current rent when nothing is remembered for the new size', () => {
    const f = floor({ rooms: resizeFloorRooms(floor(), 1, { pattern: 'NUMERIC', floorIndex: 0 }) });
    expect(applyFloorDefaults(f, { capacity: 3 }).defaultRent).toBe(6000);
  });
});

describe('rent memory', () => {
  it('records a rent against its sharing size', () => {
    const memory = rememberRent(rememberRent({}, 4, 6000), 2, 9000);
    expect(recallRent(memory, 2, null)).toBe(9000);
    expect(recallRent(memory, 4, null)).toBe(6000);
  });

  it('falls back when a size has never been priced', () => {
    expect(recallRent({ 4: 6000 }, 3, 5000)).toBe(5000);
  });

  it('ignores meaningless rents rather than remembering zero', () => {
    expect(rememberRent({}, 4, 0)).toEqual({});
    expect(rememberRent({}, 4, null)).toEqual({});
  });
});

describe('cloneFloorShape', () => {
  it('copies the mix onto the next floor with fresh numbers', () => {
    let source = floor({ rooms: resizeFloorRooms(floor(), 4, { pattern: 'NUMERIC', floorIndex: 0 }) });
    source = editRoom(source, source.rooms[3].key, { capacity: 2, rent: 9000 });

    const cloned = cloneFloorShape(source, floor({ id: 'floor-2', name: 'First floor' }), {
      pattern: 'NUMERIC',
      floorIndex: 1,
    });

    expect(cloned.name).toBe('First floor');
    expect(cloned.rooms.map((r) => r.roomNo)).toEqual(['201', '202', '203', '204']);
    expect(cloned.rooms.map((r) => r.capacity)).toEqual([4, 4, 4, 2]);
    expect(cloned.rooms.map((r) => r.rent)).toEqual([6000, 6000, 6000, 9000]);
  });

  it('gives cloned rooms their own keys so editing one does not edit both', () => {
    const source = floor({ rooms: resizeFloorRooms(floor(), 2, { pattern: 'NUMERIC', floorIndex: 0 }) });
    const cloned = cloneFloorShape(source, floor({ id: 'floor-2' }), { pattern: 'NUMERIC', floorIndex: 1 });
    const sourceKeys = new Set(source.rooms.map((r) => r.key));
    expect(cloned.rooms.some((r) => sourceKeys.has(r.key))).toBe(false);
  });
});

describe('tallies', () => {
  it('counts rooms and beds across a mixed floor', () => {
    let f = floor({ rooms: resizeFloorRooms(floor(), 4, { pattern: 'NUMERIC', floorIndex: 0 }) });
    f = editRoom(f, f.rooms[3].key, { capacity: 2 });
    // Three 4-sharing plus one 2-sharing — the user's own ground-floor example.
    expect(floorTally(f)).toEqual({ rooms: 4, beds: 14 });
  });

  it('adds floors up', () => {
    const f = floor({ rooms: resizeFloorRooms(floor(), 2, { pattern: 'NUMERIC', floorIndex: 0 }) });
    expect(buildingTally([f, f])).toEqual({ rooms: 4, beds: 16 });
  });

  it('is zero for an empty building', () => {
    expect(buildingTally([])).toEqual({ rooms: 0, beds: 0 });
  });
});

describe('buildProgress', () => {
  it('reports nothing done when no floor has rooms', () => {
    const p = buildProgress([
      { name: 'Ground floor', roomCount: 0 },
      { name: 'First floor', roomCount: 0 },
    ]);
    expect(p).toMatchObject({ floorsDone: 0, floorsTotal: 2, nextFloorIndex: 0, isComplete: false });
    expect(p.summary).toBe('2 floors to set up');
  });

  it('names the last finished floor and what remains', () => {
    const p = buildProgress([
      { name: 'Ground floor', roomCount: 4 },
      { name: 'First floor', roomCount: 0 },
      { name: 'Second floor', roomCount: 0 },
    ]);
    expect(p).toMatchObject({ floorsDone: 1, nextFloorIndex: 1, isComplete: false });
    expect(p.summary).toBe('Ground floor done · 2 to go');
  });

  it('is complete once every floor has rooms', () => {
    const p = buildProgress([
      { name: 'Ground floor', roomCount: 4 },
      { name: 'First floor', roomCount: 6 },
    ]);
    expect(p).toMatchObject({ floorsDone: 2, nextFloorIndex: null, isComplete: true });
    expect(p.summary).toBe('2 floors set up');
  });

  it('points at a gap left in the middle', () => {
    const p = buildProgress([
      { name: 'Ground floor', roomCount: 4 },
      { name: 'First floor', roomCount: 0 },
      { name: 'Second floor', roomCount: 5 },
    ]);
    expect(p.nextFloorIndex).toBe(1);
    expect(p.isComplete).toBe(false);
  });

  it('handles a hostel with no floors at all', () => {
    expect(buildProgress([])).toMatchObject({ floorsTotal: 0, isComplete: false, summary: 'No floors yet' });
  });
});

describe('toRoomsPayload', () => {
  it('sends each room with its own sharing size and rent', () => {
    let f = floor({ rooms: resizeFloorRooms(floor(), 2, { pattern: 'NUMERIC', floorIndex: 0 }) });
    f = editRoom(f, f.rooms[1].key, { capacity: 2, rent: 9000 });

    expect(toRoomsPayload(f)).toEqual([
      { room_no: '101', capacity: 4, base_rent: 6000, room_type: '4-sharing' },
      { room_no: '102', capacity: 2, base_rent: 9000, room_type: '2-sharing' },
    ]);
  });

  it('omits rent entirely when none was set, rather than sending zero', () => {
    const f = floor({
      defaultRent: null,
      rooms: resizeFloorRooms(floor({ defaultRent: null }), 1, { pattern: 'NUMERIC', floorIndex: 0 }),
    });
    expect(toRoomsPayload(f)[0]).not.toHaveProperty('base_rent');
  });
});

describe('floorBlocker', () => {
  it('passes a well-formed floor', () => {
    const f = floor({ rooms: resizeFloorRooms(floor(), 3, { pattern: 'NUMERIC', floorIndex: 0 }) });
    expect(floorBlocker(f)).toBeNull();
  });

  it('needs at least one room', () => {
    expect(floorBlocker(floor())).toBe('Add at least one room');
  });

  it('catches a duplicate room number before the server does', () => {
    let f = floor({ rooms: resizeFloorRooms(floor(), 2, { pattern: 'NUMERIC', floorIndex: 0 }) });
    f = editRoom(f, f.rooms[1].key, { roomNo: '101' });
    expect(floorBlocker(f)).toBe('Room 101 is used twice on this floor');
  });

  it('catches a blank room number', () => {
    let f = floor({ rooms: resizeFloorRooms(floor(), 1, { pattern: 'NUMERIC', floorIndex: 0 }) });
    f = editRoom(f, f.rooms[0].key, { roomNo: '  ' });
    expect(floorBlocker(f)).toBe('Every room needs a number');
  });

  it('catches a room with no sharing size', () => {
    let f = floor({ rooms: resizeFloorRooms(floor(), 1, { pattern: 'NUMERIC', floorIndex: 0 }) });
    f = editRoom(f, f.rooms[0].key, { capacity: 0 });
    expect(floorBlocker(f)).toBe('Room 101 needs a sharing size');
  });
});

/**
 * The picker used to be wired straight to `setPattern`, so changing the scheme
 * highlighted a chip and renumbered nothing. These are the rules that make it
 * actually do something.
 */
describe('renumbering when the scheme changes', () => {
  const floorWith = (roomNos: string[]) => ({
    id: 'f1',
    name: 'Ground floor',
    defaultCapacity: 4,
    defaultRent: 6000,
    saved: false,
    rooms: roomNos.map((roomNo, i) => ({
      key: `k${i}`,
      roomNo,
      capacity: 4,
      rent: 6000,
      customised: false,
    })),
  });

  it('renumbers rooms the app numbered', () => {
    const result = renumberFloor(floorWith(['101', '102', '103']), {
      from: 'NUMERIC',
      to: 'FLOOR_PREFIX',
      floorIndex: 0,
    });
    expect(result.rooms.map((r) => r.roomNo)).toEqual(['G-01', 'G-02', 'G-03']);
  });

  // The owner's name for a room outranks a scheme.
  it('leaves a room the owner named alone', () => {
    const result = renumberFloor(floorWith(['101', 'Manager cabin', '103']), {
      from: 'NUMERIC',
      to: 'FLOOR_PREFIX',
      floorIndex: 0,
    });
    expect(result.rooms.map((r) => r.roomNo)).toEqual(['G-01', 'Manager cabin', 'G-03']);
  });

  // `customised` is set by editing rent or sharing too, and changing a room's
  // price is not a claim on its name.
  it('renumbers a room customised in some other way', () => {
    const floor = floorWith(['101']);
    floor.rooms[0].customised = true;
    floor.rooms[0].rent = 9999;
    const result = renumberFloor(floor, { from: 'NUMERIC', to: 'BLOCK', floorIndex: 0 });
    expect(result.rooms[0].roomNo).toBe('A-1');
    expect(result.rooms[0].rent).toBe(9999);
  });

  it('does nothing when the scheme has not changed', () => {
    const floor = floorWith(['101', '102']);
    expect(renumberFloor(floor, { from: 'NUMERIC', to: 'NUMERIC', floorIndex: 0 })).toBe(floor);
  });

  it('keeps every other field of the room and the floor', () => {
    const result = renumberFloor(floorWith(['101']), {
      from: 'NUMERIC',
      to: 'FLOOR_PREFIX',
      floorIndex: 0,
    });
    expect(result.name).toBe('Ground floor');
    expect(result.rooms[0]).toMatchObject({ key: 'k0', capacity: 4, rent: 6000 });
  });

  it('numbers by position, so it survives a floor that is not the ground one', () => {
    const result = renumberFloor(floorWith(['201', '202']), {
      from: 'NUMERIC',
      to: 'FLOOR_PREFIX',
      floorIndex: 1,
    });
    expect(result.rooms.map((r) => r.roomNo)).toEqual(['1-01', '1-02']);
  });

  it('handles a floor with no rooms', () => {
    const empty = renumberFloor(floorWith([]), { from: 'NUMERIC', to: 'BLOCK', floorIndex: 0 });
    expect(empty.rooms).toEqual([]);
  });
});

// The scheme is one decision for the property, so changing it has to reach the
// floors already filled — otherwise one building ends up numbered two ways.
describe('renumberBuilding', () => {
  const floor = (name: string, roomNos: string[]) => ({
    id: `id-${name}`,
    name,
    defaultCapacity: 4,
    defaultRent: 6000,
    saved: false,
    rooms: roomNos.map((roomNo, i) => ({
      key: `${name}-${i}`,
      roomNo,
      capacity: 4,
      rent: 6000,
      customised: false,
    })),
  });

  it('renumbers every floor, using its own floor index', () => {
    const result = renumberBuilding(
      [floor('Ground', ['101', '102']), floor('First', ['201'])],
      'NUMERIC',
      'FLOOR_PREFIX',
    );
    expect(result[0].rooms.map((r) => r.roomNo)).toEqual(['G-01', 'G-02']);
    expect(result[1].rooms.map((r) => r.roomNo)).toEqual(['1-01']);
  });

  it('returns the same array when nothing changed', () => {
    const floors = [floor('Ground', ['101'])];
    expect(renumberBuilding(floors, 'BLOCK', 'BLOCK')).toBe(floors);
  });

  it('handles a building with no floors', () => {
    expect(renumberBuilding([], 'NUMERIC', 'BLOCK')).toEqual([]);
  });
});
