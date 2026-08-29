import { describe, it, expect } from 'vitest';
import { groupRoomsByFloor, floorIdForRoom, type SeatGridSourceRoom } from './roomSeatGrid';

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
