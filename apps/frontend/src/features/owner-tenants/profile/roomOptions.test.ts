import { describe, expect, it } from 'vitest';
import { toRoomOptions } from './roomOptions';

/**
 * Which rooms an owner may move a tenant into.
 *
 * The only previous path asked the owner to type a room's UUID into a text
 * box, which the backend then dropped — so this list is the whole feature.
 * A room that appears here must be one the shift endpoint will accept, or the
 * owner taps it and gets an error.
 */

function room(overrides: Record<string, unknown> = {}) {
  return {
    id: 'room-203',
    room_no: '203',
    floor: '2',
    capacity: 4,
    used_count: 2,
    status: 'ACTIVE',
    base_rent: 8000,
    ...overrides,
  };
}

describe('toRoomOptions', () => {
  it('offers a room that has space', () => {
    const options = toRoomOptions([room()], { currentRoomId: 'room-202' });
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ id: 'room-203', roomNo: '203', free: 2, capacity: 4 });
  });

  it('excludes the room the tenant already occupies', () => {
    const options = toRoomOptions([room({ id: 'room-202' })], { currentRoomId: 'room-202' });
    expect(options).toEqual([]);
  });

  it('excludes a full room', () => {
    const options = toRoomOptions([room({ used_count: 4 })], { currentRoomId: 'room-202' });
    expect(options).toEqual([]);
  });

  it('excludes an over-subscribed room rather than reporting negative space', () => {
    const options = toRoomOptions([room({ used_count: 6 })], { currentRoomId: 'room-202' });
    expect(options).toEqual([]);
  });

  it('excludes a room under maintenance', () => {
    const options = toRoomOptions([room({ status: 'MAINTENANCE' })], { currentRoomId: 'room-202' });
    expect(options).toEqual([]);
  });

  it('excludes a blocked room', () => {
    const options = toRoomOptions([room({ status: 'BLOCKED' })], { currentRoomId: 'room-202' });
    expect(options).toEqual([]);
  });

  it('prefers an explicit vacant_count over deriving one', () => {
    const options = toRoomOptions(
      [room({ vacant_count: 1, used_count: 0 })],
      { currentRoomId: 'room-202' },
    );
    expect(options[0].free).toBe(1);
  });

  it('falls back to occupied_count when used_count is absent', () => {
    const options = toRoomOptions(
      [room({ used_count: undefined, occupied_count: 3 })],
      { currentRoomId: 'room-202' },
    );
    expect(options[0].free).toBe(1);
  });

  it('orders rooms by floor then room number so the list reads like a building', () => {
    const options = toRoomOptions(
      [
        room({ id: 'c', room_no: '301', floor: '3' }),
        room({ id: 'a', room_no: '105', floor: '1' }),
        room({ id: 'b', room_no: '203', floor: '2' }),
      ],
      { currentRoomId: 'room-202' },
    );
    expect(options.map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });

  it('orders numerically rather than lexically within a floor', () => {
    const options = toRoomOptions(
      [
        room({ id: 'b', room_no: '110', floor: '1' }),
        room({ id: 'a', room_no: '19', floor: '1' }),
      ],
      { currentRoomId: 'room-202' },
    );
    expect(options.map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('flags a room whose rent differs from what the tenant pays now', () => {
    const options = toRoomOptions(
      [room({ base_rent: 9500 })],
      { currentRoomId: 'room-202', currentRent: 8000 },
    );
    expect(options[0].rentDiffers).toBe(true);
    expect(options[0].baseRent).toBe(9500);
  });

  it('does not flag a room whose rent matches', () => {
    const options = toRoomOptions(
      [room({ base_rent: 8000 })],
      { currentRoomId: 'room-202', currentRent: 8000 },
    );
    expect(options[0].rentDiffers).toBe(false);
  });

  it('does not flag a rent difference when the room has no rent set', () => {
    const options = toRoomOptions(
      [room({ base_rent: null })],
      { currentRoomId: 'room-202', currentRent: 8000 },
    );
    expect(options[0].rentDiffers).toBe(false);
  });

  it('returns nothing for a non-array response rather than throwing', () => {
    expect(toRoomOptions(undefined, { currentRoomId: 'room-202' })).toEqual([]);
    expect(toRoomOptions(null, { currentRoomId: 'room-202' })).toEqual([]);
  });

  it('skips rooms with no id, which cannot be submitted', () => {
    const options = toRoomOptions([room({ id: '' })], { currentRoomId: 'room-202' });
    expect(options).toEqual([]);
  });
});
