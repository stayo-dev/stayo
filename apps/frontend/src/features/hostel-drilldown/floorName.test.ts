import { describe, expect, it } from 'vitest';
import { describeFloor, floorNameProblem, isRename, tidyFloorName } from './floorName';

describe('a floor name', () => {
  it('is tidied the way the server tidies it', () => {
    expect(tidyFloorName('  Ground   floor ')).toBe('Ground floor');
  });

  it('cannot be blank', () => {
    expect(floorNameProblem('   ', [])).toBe('Give the floor a name');
  });

  it('cannot clash with another floor, whatever the case', () => {
    expect(floorNameProblem('ground', ['Ground', 'Floor 1'])).toBe(`There's already a floor called "ground"`);
  });

  it('can differ from itself only in case — that is a rename, not a clash', () => {
    expect(floorNameProblem('floor 1', ['Ground'])).toBeNull();
    expect(isRename('Floor 1', 'floor 1')).toBe(true);
  });

  it('cannot run past a phone header', () => {
    expect(floorNameProblem('x'.repeat(41), [])).toMatch(/under 40/);
    expect(floorNameProblem('x'.repeat(40), [])).toBeNull();
  });

  it('is not an edit when only spacing changed', () => {
    expect(isRename('Floor 1', '  Floor   1 ')).toBe(false);
  });
});

describe('the floor summary', () => {
  it('reads like a person would say it', () => {
    expect(describeFloor({ rooms: 6, beds: 24, vacantBeds: 5 })).toBe('6 rooms · 24 beds · 5 free');
  });

  it('says full rather than zero free', () => {
    expect(describeFloor({ rooms: 1, beds: 1, vacantBeds: 0 })).toBe('1 room · 1 bed · full');
  });

  it('says so when a floor is empty', () => {
    expect(describeFloor({ rooms: 0, beds: 0, vacantBeds: 0 })).toBe('No rooms yet');
  });
});
