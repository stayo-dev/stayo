import { describe, expect, it } from 'vitest';
import { addItem, filterByName, isOverDropZone, moveItem, removeItem, reorderIndexAt, resolveDisplayName } from './timetableDnd';

describe('isOverDropZone', () => {
  const zone = { left: 0, top: 0, right: 100, bottom: 100 };

  it('is true for a point inside the rect', () => {
    expect(isOverDropZone({ x: 50, y: 50 }, zone)).toBe(true);
  });

  it('is true on the rect boundary', () => {
    expect(isOverDropZone({ x: 0, y: 0 }, zone)).toBe(true);
    expect(isOverDropZone({ x: 100, y: 100 }, zone)).toBe(true);
  });

  it('is false outside the rect', () => {
    expect(isOverDropZone({ x: 150, y: 50 }, zone)).toBe(false);
    expect(isOverDropZone({ x: 50, y: -10 }, zone)).toBe(false);
  });
});

describe('addItem', () => {
  it('adds a new item', () => {
    expect(addItem(['a'], 'b')).toEqual({ ids: ['a', 'b'], added: true });
  });

  it('adding to an empty cell works', () => {
    expect(addItem([], 'a')).toEqual({ ids: ['a'], added: true });
  });

  it('prevents a duplicate in the same meal — no-op, reports added:false', () => {
    expect(addItem(['a', 'b'], 'a')).toEqual({ ids: ['a', 'b'], added: false });
  });

  it('the same item is allowed on a different day (a different cell = a different ids array)', () => {
    const mondayBreakfast = addItem([], 'idli').ids;
    const tuesdayBreakfast = addItem([], 'idli').ids;
    expect(mondayBreakfast).toEqual(['idli']);
    expect(tuesdayBreakfast).toEqual(['idli']);
  });

  it('the same item is allowed in a different meal slot (a different cell = a different ids array)', () => {
    const mondayBreakfast = addItem([], 'idli').ids;
    const mondayDinner = addItem([], 'idli').ids;
    expect(mondayBreakfast).toEqual(['idli']);
    expect(mondayDinner).toEqual(['idli']);
  });
});

describe('removeItem', () => {
  it('removes a present id', () => {
    expect(removeItem(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('removing an absent id is a no-op', () => {
    expect(removeItem(['a', 'b'], 'z')).toEqual(['a', 'b']);
  });
});

describe('reorderIndexAt', () => {
  const rects = [
    { left: 0, top: 0, right: 100, bottom: 40 },
    { left: 0, top: 40, right: 100, bottom: 80 },
    { left: 0, top: 80, right: 100, bottom: 120 },
  ];

  it('returns the first index for a point above every sibling', () => {
    expect(reorderIndexAt({ x: 50, y: -10 }, rects, 2)).toBe(0);
  });

  it('returns the last index for a point below every sibling', () => {
    expect(reorderIndexAt({ x: 50, y: 200 }, rects, 0)).toBe(2);
  });

  it('returns the middle index for a point over the middle sibling', () => {
    expect(reorderIndexAt({ x: 50, y: 60 }, rects, 0)).toBe(1);
  });

  it('with no siblings, returns the dragged index unchanged', () => {
    expect(reorderIndexAt({ x: 50, y: 60 }, [], 0)).toBe(0);
  });
});

describe('moveItem', () => {
  it('moves an item from the start to the end', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('moves an item from the end to the start', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('moving to the same index is a no-op', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('an out-of-range fromIndex is a no-op', () => {
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });

  it('clamps an out-of-range toIndex', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a']);
  });
});

describe('filterByName', () => {
  const items = [{ name: 'Idli' }, { name: 'Chutney' }, { name: 'Chicken Curry' }];

  it('an empty query returns every item unchanged', () => {
    expect(filterByName(items, '')).toEqual(items);
    expect(filterByName(items, '   ')).toEqual(items);
  });

  it('matches case-insensitively', () => {
    expect(filterByName(items, 'CHICKEN')).toEqual([{ name: 'Chicken Curry' }]);
  });

  it('matches a substring, not just a prefix', () => {
    expect(filterByName(items, 'curry')).toEqual([{ name: 'Chicken Curry' }]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterByName(items, 'rice')).toEqual([]);
  });
});

describe('resolveDisplayName', () => {
  it('prefers the live library name over the stored snapshot', () => {
    const liveNameById = new Map([['item-1', 'Chicken Curry Special']]);
    expect(resolveDisplayName({ menu_item_id: 'item-1', item_name: 'Chicken Curry' }, liveNameById)).toBe('Chicken Curry Special');
  });

  it('falls back to the stored snapshot when the id is not in the live map (soft-deleted)', () => {
    const liveNameById = new Map([['item-1', 'Chicken Curry Special']]);
    expect(resolveDisplayName({ menu_item_id: 'item-2', item_name: 'Paneer Curry' }, liveNameById)).toBe('Paneer Curry');
  });

  it('falls back to the stored snapshot when menu_item_id is null', () => {
    const liveNameById = new Map([['item-1', 'Chicken Curry Special']]);
    expect(resolveDisplayName({ menu_item_id: null, item_name: 'Orphaned Dish' }, liveNameById)).toBe('Orphaned Dish');
  });
});
