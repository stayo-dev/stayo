import { describe, it, expect } from 'vitest';
import {
  describeRoomOccupancy,
  floorIdForRoom,
  groupRoomsByFloor,
  occupancyLabel,
  type SeatGridSourceRoom,
} from './roomSeatGrid';

const rooms: SeatGridSourceRoom[] = [
  { id: 'r1', roomNo: 'G101', floorId: 'f-ground', floorName: 'Ground', available: 2 },
  { id: 'r2', roomNo: 'G102', floorId: 'f-ground', floorName: 'Ground', available: 0 },
  { id: 'r3', roomNo: '101', floorId: 'f-1', floorName: '1st Floor', available: 1 },
  { id: 'r4', roomNo: 'X1', floorId: null, floorName: null, available: 3 },
];

describe('groupRoomsByFloor', () => {
  it('groups rooms under their floor, preserving first-seen floor order', () => {
    const floors = groupRoomsByFloor(rooms);
    expect(floors.map((f) => f.id)).toEqual(['f-ground', 'f-1', '__unassigned']);
    expect(floors[0].rooms.map((r) => r.roomNo)).toEqual(['G101', 'G102']);
  });

  it('marks a room with no beds free as unavailable', () => {
    const floors = groupRoomsByFloor(rooms);
    const g102 = floors[0].rooms.find((r) => r.roomNo === 'G102');
    expect(g102?.state).toBe('unavailable');
  });

  it('marks a room with beds free as available by default', () => {
    const floors = groupRoomsByFloor(rooms);
    const g101 = floors[0].rooms.find((r) => r.roomNo === 'G101');
    expect(g101?.state).toBe('available');
  });

  it('marks the selected room as selected even when it has beds free', () => {
    const floors = groupRoomsByFloor(rooms, { selectedRoomId: 'r1' });
    const g101 = floors[0].rooms.find((r) => r.roomNo === 'G101');
    expect(g101?.state).toBe('selected');
  });

  it('buckets rooms with no floor under a synthetic "Other" floor instead of dropping them', () => {
    const floors = groupRoomsByFloor(rooms);
    const unassigned = floors.find((f) => f.id === '__unassigned');
    expect(unassigned?.name).toBe('Other');
    expect(unassigned?.rooms.map((r) => r.roomNo)).toEqual(['X1']);
  });

  it('returns no floors for an empty room list', () => {
    expect(groupRoomsByFloor([])).toEqual([]);
  });
});

describe('floorIdForRoom', () => {
  it('finds the floor a room belongs to', () => {
    expect(floorIdForRoom(rooms, 'r3')).toBe('f-1');
  });

  it('returns null for a room not in the list', () => {
    expect(floorIdForRoom(rooms, 'does-not-exist')).toBeNull();
  });

  it('returns null for a room with no floor assigned', () => {
    expect(floorIdForRoom(rooms, 'r4')).toBeNull();
  });
});

/**
 * Occupancy. The owner's real question at this step is "which rooms have
 * space", which is a scanning question — so the count belongs on every square,
 * not behind an inspection gesture.
 */
describe('occupancyLabel', () => {
  it('counts free beds', () => {
    expect(occupancyLabel(3, 1)).toBe('1 free');
    expect(occupancyLabel(3, 3)).toBe('3 free');
  });

  it('says Full rather than "0 free"', () => {
    expect(occupancyLabel(3, 0)).toBe('Full');
  });

  it('says nothing when capacity is unknown, instead of inventing a count', () => {
    expect(occupancyLabel(0, 0)).toBeNull();
    expect(occupancyLabel(0, 2)).toBeNull();
  });
});

describe('describeRoomOccupancy', () => {
  it('says what the count is counting', () => {
    expect(describeRoomOccupancy(3, 1)).toBe('3 beds · 1 free');
    expect(describeRoomOccupancy(3, 0)).toBe('3 beds · full');
  });

  it('does not pluralise a single bed', () => {
    expect(describeRoomOccupancy(1, 1)).toBe('1 bed · 1 free');
  });

  it('stays silent without a capacity', () => {
    expect(describeRoomOccupancy(0, 0)).toBeNull();
  });
});

describe('groupRoomsByFloor — occupancy', () => {
  it('carries capacity, used and free beds onto every room', () => {
    const [floor] = groupRoomsByFloor([
      { id: 'r1', roomNo: '101', floorId: 'f1', floorName: 'Ground', available: 1, capacity: 3, used: 2 },
    ]);
    expect(floor.rooms[0]).toMatchObject({
      capacity: 3,
      used: 2,
      available: 1,
      occupancyLabel: '1 free',
    });
  });

  it('prefers an explicit `used`, which counts beds held by a live invitation', () => {
    // capacity - available would say 1; the room really has 2 beds spoken for,
    // one of them by an invitee who has not activated yet.
    const [floor] = groupRoomsByFloor([
      { id: 'r1', roomNo: '101', floorId: 'f1', floorName: 'Ground', available: 2, capacity: 3, used: 1 },
    ]);
    expect(floor.rooms[0].used).toBe(1);
  });

  it('derives used from capacity when the caller has no separate figure', () => {
    const [floor] = groupRoomsByFloor([
      { id: 'r1', roomNo: '101', floorId: 'f1', floorName: 'Ground', available: 1, capacity: 4 },
    ]);
    expect(floor.rooms[0].used).toBe(3);
  });

  it('leaves the tenant-facing picker unchanged, which supplies no capacity at all', () => {
    const [floor] = groupRoomsByFloor([
      { id: 'r1', roomNo: '101', floorId: 'f1', floorName: 'Ground', available: 2 },
    ]);
    expect(floor.rooms[0]).toMatchObject({ capacity: 0, used: 0, occupancyLabel: null });
    expect(floor.rooms[0].state).toBe('available');
  });

  it('never reports a negative count from inconsistent inputs', () => {
    const [floor] = groupRoomsByFloor([
      { id: 'r1', roomNo: '101', floorId: 'f1', floorName: 'Ground', available: 5, capacity: 3 },
    ]);
    expect(floor.rooms[0].used).toBe(0);
  });
});
