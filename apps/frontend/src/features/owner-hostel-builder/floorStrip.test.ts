import { describe, it, expect } from 'vitest';
import {
  floorChipState,
  nextFloorNeedingRooms,
  primaryFloorAction,
  primaryFloorLabel,
  sweepBlocker,
  unsavedFloorIndexes,
} from './floorStrip';
import type { DraftFloor, DraftRoom } from './hostelBuilder';

const room = (roomNo: string, over: Partial<DraftRoom> = {}): DraftRoom => ({
  key: `k-${roomNo}`,
  roomNo,
  capacity: 4,
  rent: 6000,
  customised: false,
  ...over,
});

const floor = (name: string, rooms: DraftRoom[], saved = false): DraftFloor => ({
  id: `id-${name}`,
  name,
  defaultCapacity: 4,
  defaultRent: 6000,
  rooms,
  saved,
});

const GROUND = floor('Ground floor', [room('101')], true);
const FIRST = floor('First floor', [room('201')]);
const SECOND = floor('Second floor', []);

describe('floorChipState', () => {
  it('marks a written floor saved', () => {
    expect(floorChipState(GROUND)).toBe('saved');
  });

  it('marks a floor with rooms nobody has written a draft', () => {
    expect(floorChipState(FIRST)).toBe('draft');
  });

  it('marks a floor with no rooms empty, saved flag or not', () => {
    expect(floorChipState(SECOND)).toBe('empty');
    expect(floorChipState(floor('Odd', [], true))).toBe('empty');
  });

  it('does not throw on a missing floor', () => {
    expect(floorChipState(undefined as any)).toBe('empty');
  });
});

// What the finish sweeps up. This is the guarantee free navigation removed:
// previously you could not reach floor 3 without floor 1 being written.
describe('unsavedFloorIndexes', () => {
  it('finds floors holding rooms that were never written', () => {
    expect(unsavedFloorIndexes([GROUND, FIRST, SECOND])).toEqual([1]);
  });

  it('returns nothing when every floor with rooms is saved', () => {
    expect(unsavedFloorIndexes([GROUND, floor('First', [room('201')], true)])).toEqual([]);
  });

  it('never includes an empty floor — there is nothing to save', () => {
    expect(unsavedFloorIndexes([SECOND])).toEqual([]);
  });

  it('handles no floors at all', () => {
    expect(unsavedFloorIndexes([])).toEqual([]);
    expect(unsavedFloorIndexes(undefined as any)).toEqual([]);
  });
});

describe('nextFloorNeedingRooms', () => {
  it('finds the next floor with no rooms yet', () => {
    expect(nextFloorNeedingRooms([GROUND, FIRST, SECOND], 0)).toBe(2);
  });

  // Once navigation is free, finishing the last floor should send the owner
  // back to the ground floor they skipped, not onward to Review.
  it('wraps to the start rather than stopping at the end', () => {
    expect(nextFloorNeedingRooms([SECOND, GROUND, FIRST], 2)).toBe(0);
  });

  it('returns null when every floor has rooms', () => {
    expect(nextFloorNeedingRooms([GROUND, FIRST], 0)).toBeNull();
  });

  it('never returns the floor it started on when that floor has rooms', () => {
    expect(nextFloorNeedingRooms([GROUND, SECOND], 0)).toBe(1);
  });

  it('returns the current floor when it is the only empty one', () => {
    // Wrapping all the way round is correct here: it is genuinely the only
    // floor still needing input.
    expect(nextFloorNeedingRooms([GROUND, SECOND], 1)).toBe(1);
  });

  it('handles an empty building', () => {
    expect(nextFloorNeedingRooms([], 0)).toBeNull();
  });
});

describe('primaryFloorAction', () => {
  // It used to go to activeIndex + 1 blindly, which with a switcher marches
  // past floors already filled and stops short of ones that were skipped.
  it('continues to the floor that still needs rooms, not simply the next one', () => {
    expect(primaryFloorAction([GROUND, FIRST, SECOND], 0)).toEqual({ kind: 'continue', nextIndex: 2 });
  });

  it('finishes once every floor has rooms', () => {
    expect(primaryFloorAction([GROUND, FIRST], 1)).toEqual({ kind: 'finish' });
  });

  it('labels itself accordingly', () => {
    expect(primaryFloorLabel({ kind: 'finish' })).toMatch(/finish/i);
    expect(primaryFloorLabel({ kind: 'continue', nextIndex: 1 })).toMatch(/continue/i);
  });
});

describe('sweepBlocker', () => {
  it('passes when every unsaved floor is valid', () => {
    expect(sweepBlocker([GROUND, FIRST, SECOND])).toBeNull();
  });

  // A partial sweep that writes two floors then fails on a third is the worst
  // outcome, so every floor is checked before any of them is written.
  it('names the floor and the reason before anything is written', () => {
    const broken = floor('First floor', [room('201'), room('  ')]);
    const result = sweepBlocker([GROUND, broken]);
    expect(result).not.toBeNull();
    expect(result!.index).toBe(1);
    expect(result!.reason).toMatch(/^First floor: /);
    expect(result!.reason).toMatch(/needs a number/i);
  });

  it('catches a duplicate room number on a floor the owner is not looking at', () => {
    const dupes = floor('Second floor', [room('301'), room('301')]);
    expect(sweepBlocker([GROUND, dupes])!.reason).toMatch(/used twice/i);
  });

  it('ignores floors that are already saved', () => {
    // A saved floor is not in the sweep, so its contents are not re-validated.
    const savedButOdd = floor('Ground floor', [room('101')], true);
    expect(sweepBlocker([savedButOdd])).toBeNull();
  });

  it('ignores empty floors', () => {
    expect(sweepBlocker([SECOND])).toBeNull();
  });
});
