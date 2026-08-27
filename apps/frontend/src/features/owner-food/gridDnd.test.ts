import { describe, expect, it } from 'vitest';
import { planCopyToDays } from './gridDnd';

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
