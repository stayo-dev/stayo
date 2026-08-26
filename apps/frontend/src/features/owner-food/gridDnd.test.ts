import { describe, expect, it } from 'vitest';
import { findDropTarget, planCopyToDays, type GridCellRect } from './gridDnd';

describe('findDropTarget', () => {
  const cells: GridCellRect[] = [
    { day: 'MONDAY', slot: 'breakfast', rect: { left: 0, top: 0, right: 100, bottom: 40 } },
    { day: 'TUESDAY', slot: 'breakfast', rect: { left: 100, top: 0, right: 200, bottom: 40 } },
    { day: 'MONDAY', slot: 'lunch', rect: { left: 0, top: 40, right: 100, bottom: 80 } },
  ];

  it('resolves the one cell a point falls inside, among several simultaneously-live zones', () => {
    expect(findDropTarget({ x: 150, y: 20 }, cells)).toEqual({ day: 'TUESDAY', slot: 'breakfast' });
  });

  it('disambiguates a different cell correctly', () => {
    expect(findDropTarget({ x: 50, y: 60 }, cells)).toEqual({ day: 'MONDAY', slot: 'lunch' });
  });

  it('returns null for a point outside every cell', () => {
    expect(findDropTarget({ x: 500, y: 500 }, cells)).toBeNull();
  });

  it('returns null when there are no cells', () => {
    expect(findDropTarget({ x: 10, y: 10 }, [])).toBeNull();
  });
});

describe('planCopyToDays', () => {
  it('plans one entry per target day, carrying the source ids', () => {
    const source = [{ menu_item_id: 'idli' }, { menu_item_id: 'chutney' }];
    expect(planCopyToDays(source, ['TUESDAY', 'THURSDAY'])).toEqual([
      { day: 'TUESDAY', ids: ['idli', 'chutney'] },
      { day: 'THURSDAY', ids: ['idli', 'chutney'] },
    ]);
  });

  it('drops orphaned (null menu_item_id) items rather than copying a hole', () => {
    const source = [{ menu_item_id: 'idli' }, { menu_item_id: null }];
    expect(planCopyToDays(source, ['TUESDAY'])).toEqual([{ day: 'TUESDAY', ids: ['idli'] }]);
  });

  it('an empty source plans a clear for every target day', () => {
    expect(planCopyToDays([], ['TUESDAY', 'WEDNESDAY'])).toEqual([
      { day: 'TUESDAY', ids: [] },
      { day: 'WEDNESDAY', ids: [] },
    ]);
  });

  it('no target days plans nothing', () => {
    expect(planCopyToDays([{ menu_item_id: 'idli' }], [])).toEqual([]);
  });
});
