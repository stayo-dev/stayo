import { describe, expect, it } from 'vitest';
import { mostCommon, newFloorRoomNumbers, nextRoomNumber, suggestFloorName, suggestRoomDefaults } from './roomSuggestions';

describe('nextRoomNumber', () => {
  it('continues after the highest room on the floor', () => {
    expect(nextRoomNumber(['301', '302', '304'], ['301', '302', '304'], '2')).toBe('305');
  });

  it('keeps the prefix and the padding', () => {
    expect(nextRoomNumber(['G01', 'G04'], [], 'G')).toBe('G05');
    expect(nextRoomNumber(['A-9'], [], 'A')).toBe('A-10');
    expect(nextRoomNumber(['009'], [], '0')).toBe('010');
  });

  it('starts an empty floor from its plate', () => {
    expect(nextRoomNumber([], [], '4')).toBe('401');
    expect(nextRoomNumber([], [], 'G')).toBe('G01');
  });

  it('never suggests a number the hostel already has', () => {
    expect(nextRoomNumber(['305'], ['305', '306', '307'], '3')).toBe('308');
    expect(nextRoomNumber([], ['401', 'g01'], 'G')).toBe('G02');
  });

  it('ignores rooms with no number in them', () => {
    expect(nextRoomNumber(['Suite'], ['Suite'], '1')).toBe('101');
  });
});

describe('newFloorRoomNumbers', () => {
  it('numbers a new floor from its plate, skipping taken ones', () => {
    expect(newFloorRoomNumbers('4', 3, [])).toEqual(['401', '402', '403']);
    expect(newFloorRoomNumbers('G', 2, ['G01'])).toEqual(['G02', 'G03']);
  });

  it('makes nothing for no rooms', () => {
    expect(newFloorRoomNumbers('4', 0, [])).toEqual([]);
  });
});

describe('mostCommon', () => {
  it('picks the most frequent, the first on a tie, and nothing from nothing', () => {
    expect(mostCommon([4, 3, 4, 2])).toBe(4);
    expect(mostCommon([3, 4])).toBe(3);
    expect(mostCommon([])).toBeNull();
  });
});

describe('suggestRoomDefaults', () => {
  const r = (number: string, capacity: number, rent: number) => ({ number, capacity, rent });

  it('copies the floor’s usual room', () => {
    const d = suggestRoomDefaults({ floorRooms: [r('301', 3, 9000), r('302', 3, 9000), r('303', 4, 8000)], hostelRooms: [], plate: '3' });
    expect(d).toEqual({ roomNo: '304', capacity: 3, rent: 9000 });
  });

  it('falls back to the hostel’s usual room on an empty floor', () => {
    const d = suggestRoomDefaults({ floorRooms: [], hostelRooms: [r('101', 2, 7000), r('102', 2, 7000)], plate: '2' });
    expect(d).toEqual({ roomNo: '201', capacity: 2, rent: 7000 });
  });

  it('asks for rent rather than guessing ₹0 in a brand-new hostel', () => {
    expect(suggestRoomDefaults({ floorRooms: [], hostelRooms: [], plate: 'G' })).toEqual({ roomNo: 'G01', capacity: 4, rent: null });
  });

  it('does not learn a rent of zero', () => {
    expect(suggestRoomDefaults({ floorRooms: [r('101', 4, 0)], hostelRooms: [r('101', 4, 0)], plate: '1' }).rent).toBeNull();
  });
});

describe('suggestFloorName', () => {
  it('starts at the ground', () => expect(suggestFloorName([])).toBe('Ground floor'));

  it('climbs in the owner’s own style', () => {
    expect(suggestFloorName(['Ground floor', 'First floor', 'Second floor'])).toBe('Third floor');
    expect(suggestFloorName(['Ground floor'])).toBe('First floor');
    expect(suggestFloorName(['1st floor', '2nd floor'])).toBe('3rd floor');
    expect(suggestFloorName(['Floor 1', 'Floor 2'])).toBe('Floor 3');
    expect(suggestFloorName(['Level 1'])).toBe('Level 2');
  });

  it('counts on when it recognises nothing', () => {
    expect(suggestFloorName(['Annexe', 'Main block'])).toBe('Floor 3');
  });

  it('never suggests a name that is taken', () => {
    expect(suggestFloorName(['Ground floor', 'First floor', 'floor 2', 'Annexe'])).not.toMatch(/^floor 2$/i);
    expect(suggestFloorName(['Annexe', 'Floor 3', 'Main block'])).not.toMatch(/^floor 3$/i);
  });

  it('switches to numbers past the twentieth', () => {
    expect(suggestFloorName(['Twentieth floor'])).toBe('Floor 21');
  });
});
