import { describe, expect, it } from 'vitest';
import { applyPendingEdits, clearFlushed, hasPendingChanges, setPendingEdit, shouldBufferEdits, type PendingEdits } from './pendingEdits';
import { EMPTY_CELL_LABEL, type WeekGrid } from './weekGrid';

describe('shouldBufferEdits', () => {
  it('is true for a PUBLISHED schedule', () => {
    expect(shouldBufferEdits('PUBLISHED')).toBe(true);
  });

  it('is false for a DRAFT schedule', () => {
    expect(shouldBufferEdits('DRAFT')).toBe(false);
  });

  it('is false when there is no schedule yet', () => {
    expect(shouldBufferEdits(undefined)).toBe(false);
  });
});

describe('setPendingEdit', () => {
  it('adds a new entry', () => {
    expect(setPendingEdit({}, 'meal-1', ['idli'])).toEqual({ 'meal-1': ['idli'] });
  });

  it('overwrites an existing entry for the same mealId', () => {
    const pending: PendingEdits = { 'meal-1': ['idli'] };
    expect(setPendingEdit(pending, 'meal-1', ['dosa'])).toEqual({ 'meal-1': ['dosa'] });
  });

  it('does not mutate the input object', () => {
    const pending: PendingEdits = { 'meal-1': ['idli'] };
    setPendingEdit(pending, 'meal-2', ['dosa']);
    expect(pending).toEqual({ 'meal-1': ['idli'] });
  });
});

describe('hasPendingChanges', () => {
  it('is false for an empty map', () => {
    expect(hasPendingChanges({})).toBe(false);
  });

  it('is true with at least one entry', () => {
    expect(hasPendingChanges({ 'meal-1': ['idli'] })).toBe(true);
  });
});

describe('clearFlushed', () => {
  const pending: PendingEdits = { 'meal-1': ['idli'], 'meal-2': ['dosa'], 'meal-3': ['upma'] };

  it('drops entries not in the failed list', () => {
    expect(clearFlushed(pending, ['meal-2'])).toEqual({ 'meal-2': ['dosa'] });
  });

  it('an empty failed list clears everything', () => {
    expect(clearFlushed(pending, [])).toEqual({});
  });

  it('keeps every entry when every save failed', () => {
    expect(clearFlushed(pending, ['meal-1', 'meal-2', 'meal-3'])).toEqual(pending);
  });
});

describe('applyPendingEdits', () => {
  const grid: WeekGrid = [
    {
      id: 'meal-1',
      day_of_week: 'MONDAY',
      meal_type: 'breakfast',
      updated_at: '2026-08-01T00:00:00Z',
      items: [{ id: 'row-1', menu_item_id: 'idli-id', item_name: 'Idli', display_order: 0 }],
      menu_item_id: 'idli-id',
      item_name: 'Idli',
    },
    {
      id: 'meal-2',
      day_of_week: 'MONDAY',
      meal_type: 'lunch',
      updated_at: null,
      items: [],
      menu_item_id: null,
      item_name: EMPTY_CELL_LABEL,
    },
    {
      id: null,
      day_of_week: 'MONDAY',
      meal_type: 'snacks',
      updated_at: null,
      items: [],
      menu_item_id: null,
      item_name: EMPTY_CELL_LABEL,
    },
  ];

  it('is a no-op when there are no pending edits', () => {
    expect(applyPendingEdits(grid, {})).toEqual(grid);
  });

  it('overlays a matching cell id with the pending items', () => {
    const result = applyPendingEdits(grid, { 'meal-1': ['idli-id', 'dosa-id'] });
    const cell = result.find((c) => c.id === 'meal-1')!;
    expect(cell.items.map((i) => i.menu_item_id)).toEqual(['idli-id', 'dosa-id']);
    expect(cell.menu_item_id).toBe('idli-id');
  });

  it('leaves a cell whose id is not in pending untouched', () => {
    const result = applyPendingEdits(grid, { 'meal-1': ['dosa-id'] });
    const untouched = result.find((c) => c.id === 'meal-2')!;
    expect(untouched).toEqual(grid[1]);
  });

  it('leaves a cell with id === null untouched (never matched)', () => {
    const result = applyPendingEdits(grid, { 'meal-1': ['dosa-id'] });
    const nullCell = result.find((c) => c.day_of_week === 'MONDAY' && c.meal_type === 'snacks')!;
    expect(nullCell).toEqual(grid[2]);
  });

  it('an empty pending array for a cell clears it to the empty label', () => {
    const result = applyPendingEdits(grid, { 'meal-1': [] });
    const cell = result.find((c) => c.id === 'meal-1')!;
    expect(cell.items).toEqual([]);
    expect(cell.menu_item_id).toBeNull();
    expect(cell.item_name).toBe(EMPTY_CELL_LABEL);
  });
});
