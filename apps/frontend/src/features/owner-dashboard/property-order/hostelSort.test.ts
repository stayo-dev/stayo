import { describe, expect, it } from 'vitest';
import {
  sortHostels,
  moveItem,
  canMoveUp,
  canMoveDown,
  isReorderable,
  occupancyTone,
  type SortableHostel,
} from './hostelSort';

function h(
  id: string,
  name: string,
  overrides: Partial<SortableHostel> = {},
): SortableHostel {
  return {
    id,
    name,
    displayOrder: null,
    outstandingValue: 0,
    revenueValue: 0,
    occupancyPercent: 0,
    ...overrides,
  };
}

describe('sortHostels', () => {
  it('custom: orders by displayOrder ascending', () => {
    const list = [h('a', 'A', { displayOrder: 2 }), h('b', 'B', { displayOrder: 0 }), h('c', 'C', { displayOrder: 1 })];
    expect(sortHostels(list, 'custom').map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('custom: nulls sort last, then by name — matching the server', () => {
    const list = [h('z', 'Zulu'), h('a', 'Alpha'), h('p', 'Papa', { displayOrder: 5 })];
    expect(sortHostels(list, 'custom').map((x) => x.id)).toEqual(['p', 'a', 'z']);
  });

  it('custom: all-null falls back to name, i.e. the pre-feature order', () => {
    const list = [h('z', 'Zulu'), h('a', 'Alpha'), h('m', 'Mike')];
    expect(sortHostels(list, 'custom').map((x) => x.id)).toEqual(['a', 'm', 'z']);
  });

  it('dues: highest outstanding first', () => {
    const list = [
      h('a', 'A', { outstandingValue: 26400 }),
      h('b', 'B', { outstandingValue: 82200 }),
      h('c', 'C', { outstandingValue: 0 }),
    ];
    expect(sortHostels(list, 'dues').map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('revenue: highest first', () => {
    const list = [h('a', 'A', { revenueValue: 70400 }), h('b', 'B', { revenueValue: 132600 })];
    expect(sortHostels(list, 'revenue').map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('occupancy: most vacant (lowest occupancy) first', () => {
    const list = [h('a', 'A', { occupancyPercent: 88 }), h('b', 'B', { occupancyPercent: 75 })];
    expect(sortHostels(list, 'occupancy').map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('breaks ties by name so the order is stable, not API-dependent', () => {
    const list = [
      h('z', 'Zulu', { outstandingValue: 500 }),
      h('a', 'Alpha', { outstandingValue: 500 }),
      h('m', 'Mike', { outstandingValue: 500 }),
    ];
    expect(sortHostels(list, 'dues').map((x) => x.id)).toEqual(['a', 'm', 'z']);
  });

  it('never mutates the input array', () => {
    const list = [h('b', 'B'), h('a', 'A')];
    const snapshot = list.map((x) => x.id);
    sortHostels(list, 'name');
    expect(list.map((x) => x.id)).toEqual(snapshot);
  });

  it('handles an empty list', () => {
    expect(sortHostels([], 'dues')).toEqual([]);
  });
});

describe('isReorderable', () => {
  it('allows drag only in custom mode', () => {
    expect(isReorderable('custom')).toBe(true);
    for (const mode of ['dues', 'occupancy', 'revenue', 'name'] as const) {
      expect(isReorderable(mode)).toBe(false);
    }
  });
});

describe('moveItem', () => {
  const base = ['a', 'b', 'c', 'd'];

  it('moves an item down', () => {
    expect(moveItem(base, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item up', () => {
    expect(moveItem(base, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('clamps past the end instead of dropping the item', () => {
    expect(moveItem(base, 0, 99)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('clamps past the start', () => {
    expect(moveItem(base, 3, -5)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('is a no-op when the target equals the source', () => {
    expect(moveItem(base, 1, 1)).toBe(base);
  });

  it('is a no-op for an out-of-range source', () => {
    expect(moveItem(base, 9, 0)).toBe(base);
  });

  it('never mutates the input', () => {
    const list = ['a', 'b', 'c'];
    moveItem(list, 0, 2);
    expect(list).toEqual(['a', 'b', 'c']);
  });
});

describe('occupancyTone', () => {
  it('distinguishes healthy, watch and problem occupancy', () => {
    expect(occupancyTone(88)).toBe('success');
    expect(occupancyTone(75)).toBe('warning');
    expect(occupancyTone(40)).toBe('destructive');
  });

  it('is inclusive at the thresholds', () => {
    expect(occupancyTone(85)).toBe('success');
    expect(occupancyTone(84.9)).toBe('warning');
    expect(occupancyTone(60)).toBe('warning');
    expect(occupancyTone(59.9)).toBe('destructive');
  });

  it('handles the empty-property edge', () => {
    expect(occupancyTone(0)).toBe('destructive');
    expect(occupancyTone(100)).toBe('success');
  });
});

describe('move guards', () => {
  it('cannot move the first item up or the last item down', () => {
    expect(canMoveUp(0)).toBe(false);
    expect(canMoveUp(1)).toBe(true);
    expect(canMoveDown(2, 3)).toBe(false);
    expect(canMoveDown(1, 3)).toBe(true);
  });

  it('a single-item list can move neither way', () => {
    expect(canMoveUp(0)).toBe(false);
    expect(canMoveDown(0, 1)).toBe(false);
  });
});
