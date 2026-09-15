import { describe, it, expect } from 'vitest';
import {
  dropIndex,
  floorDropIndex,
  floorOrderForSave,
  keyboardTarget,
  moveItem,
  orderChanged,
  type TileBox,
} from './arrangeModel';

/** Four 50x50 tiles across one row, 10px apart, starting at x=0. */
const row = (count: number, top = 0): TileBox[] =>
  Array.from({ length: count }, (_, i) => ({ id: `r${i}`, left: i * 60, top, width: 50, height: 50 }));

/** The centre of tile `i` in a `row()`. */
const at = (i: number, top = 0) => ({ x: i * 60 + 25, y: top + 25 });

describe('moveItem', () => {
  it('moves an item forward', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item backward', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('returns the same list when nothing moves', () => {
    const order = ['a', 'b', 'c'];
    expect(moveItem(order, 1, 1)).toBe(order);
  });

  it('leaves the list alone rather than throwing on an out-of-range drop', () => {
    const order = ['a', 'b', 'c'];
    expect(moveItem(order, 0, 9)).toBe(order);
    expect(moveItem(order, -1, 0)).toBe(order);
  });
});

describe('dropIndex — rooms in a wrapping grid', () => {
  it('stays put when the tile has not moved', () => {
    const boxes = row(4);
    expect(dropIndex(boxes, 1, at(1).x, at(1).y)).toBe(1);
  });

  it('lands on the tile the pointer is over', () => {
    const boxes = row(4);
    expect(dropIndex(boxes, 0, at(3).x, at(3).y)).toBe(3);
  });

  it('moves backward as readily as forward', () => {
    const boxes = row(4);
    expect(dropIndex(boxes, 3, at(0).x, at(0).y)).toBe(0);
  });

  it('holds its slot while the pointer sits on the seam between two tiles', () => {
    // Just past tile 1's left edge is not yet "in" tile 1 — without this the
    // tile flickers between two slots under a resting finger.
    const boxes = row(4);
    expect(dropIndex(boxes, 0, 60 + 2, 25)).toBe(0);
  });

  it('crosses rows when the grid wraps', () => {
    // Two rows of three: the second row sits 60px below the first.
    const boxes = [...row(3), ...row(3, 60).map((b, i) => ({ ...b, id: `r${i + 3}` }))];
    expect(dropIndex(boxes, 0, at(1, 60).x, at(1, 60).y)).toBe(4);
  });

  it('ignores a drag on a floor with a single room', () => {
    expect(dropIndex(row(1), 0, 999, 999)).toBe(0);
  });

  it('leaves an out-of-range index alone', () => {
    expect(dropIndex(row(3), 7, 0, 0)).toBe(7);
  });
});

describe('floorDropIndex — bands of different heights', () => {
  const heights = [100, 200, 100, 300];

  it('stays put for a nudge smaller than half the neighbour', () => {
    expect(floorDropIndex(heights, 1, 40)).toBe(1);
    expect(floorDropIndex(heights, 1, -40)).toBe(1);
  });

  it('moves up once it has covered half the band above', () => {
    expect(floorDropIndex(heights, 1, -60)).toBe(0);
  });

  it('moves down once it has covered half the band below', () => {
    expect(floorDropIndex(heights, 1, 60)).toBe(2);
  });

  it('measures each band separately rather than assuming one row height', () => {
    // From index 0: past half of band 1 (100) puts it at 1; continuing past
    // half of band 2 (50 more) puts it at 2.
    expect(floorDropIndex(heights, 0, 100)).toBe(1);
    expect(floorDropIndex(heights, 0, 260)).toBe(2);
  });

  it('clamps at the top and the bottom', () => {
    expect(floorDropIndex(heights, 0, -9999)).toBe(0);
    expect(floorDropIndex(heights, 3, 9999)).toBe(3);
  });
});

describe('keyboardTarget', () => {
  it('steps one tile left and right', () => {
    expect(keyboardTarget('ArrowRight', 0, 6, 3)).toBe(1);
    expect(keyboardTarget('ArrowLeft', 2, 6, 3)).toBe(1);
  });

  it('steps a whole row up and down', () => {
    expect(keyboardTarget('ArrowDown', 0, 6, 3)).toBe(3);
    expect(keyboardTarget('ArrowUp', 4, 6, 3)).toBe(1);
  });

  it('clamps instead of wrapping', () => {
    expect(keyboardTarget('ArrowDown', 5, 6, 3)).toBe(5);
    expect(keyboardTarget('ArrowUp', 0, 6, 3)).toBe(0);
    expect(keyboardTarget('ArrowLeft', 0, 6, 3)).toBe(0);
  });

  it('jumps to either end', () => {
    expect(keyboardTarget('Home', 4, 6, 3)).toBe(0);
    expect(keyboardTarget('End', 1, 6, 3)).toBe(5);
  });

  it('treats a single column as one step in every direction', () => {
    expect(keyboardTarget('ArrowDown', 1, 4, 1)).toBe(2);
    expect(keyboardTarget('ArrowUp', 1, 4, 1)).toBe(0);
  });

  it('ignores keys that are not a move', () => {
    expect(keyboardTarget('a', 1, 4, 2)).toBeNull();
    expect(keyboardTarget('Enter', 1, 4, 2)).toBeNull();
  });
});

describe('floorOrderForSave — the direction bug this mode was built to end', () => {
  it('writes the stack bottom-up, because sort_order counts from the ground', () => {
    // Read top-down the building is [5th, 4th, ..., Ground]; `reorderFloors`
    // persists `sort_order: index`, so Ground has to be written first.
    const stacked = [{ id: 'f5' }, { id: 'f4' }, { id: 'g' }];
    expect(floorOrderForSave(stacked)).toEqual(['g', 'f4', 'f5']);
  });

  it('does not mutate the stack it was given', () => {
    const stacked = [{ id: 'a' }, { id: 'b' }];
    floorOrderForSave(stacked);
    expect(stacked.map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('round-trips a single floor', () => {
    expect(floorOrderForSave([{ id: 'only' }])).toEqual(['only']);
  });
});

describe('orderChanged', () => {
  it('is false for an untouched order', () => {
    expect(orderChanged(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(false);
  });

  it('is true when two items swap', () => {
    expect(orderChanged(['a', 'b', 'c'], ['b', 'a', 'c'])).toBe(true);
  });

  it('is true when the length differs', () => {
    expect(orderChanged(['a', 'b'], ['a'])).toBe(true);
  });
});
