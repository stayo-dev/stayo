import { describe, expect, it } from 'vitest';
import {
  toWeekGrid, dayKeyFor, cellAt, isFilled, dayCompleteness, mealSlotAt, MEAL_TIMES,
  type WeekGrid,
} from './weekGrid';

const raw = (day: string, meal: string, name: string, itemId: string | null = 'i1') => ({
  id: `${day}-${meal}`, day_of_week: day, meal_type: meal, menu_item_id: itemId, item_name: name,
});

const fullWeek: WeekGrid = toWeekGrid(
  ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'].flatMap((d) =>
    ['BREAKFAST', 'LUNCH', 'SNACKS', 'DINNER'].map((m) => raw(d, m, `${m} item`)),
  ),
);

describe('toWeekGrid', () => {
  it('lowercases meal_type into the slot key used across the app', () => {
    const grid = toWeekGrid([raw('MONDAY', 'BREAKFAST', 'Dosa')]);
    expect(grid[0].meal_type).toBe('breakfast');
  });

  it('returns an empty grid for null/undefined input', () => {
    expect(toWeekGrid(undefined)).toEqual([]);
    expect(toWeekGrid(null)).toEqual([]);
  });

  it('drops rows with an unrecognised day or meal type rather than corrupting the grid', () => {
    const grid = toWeekGrid([raw('FUNDAY', 'BREAKFAST', 'X'), raw('MONDAY', 'BRUNCH', 'Y')]);
    expect(grid).toEqual([]);
  });
});

describe('dayKeyFor', () => {
  it('maps a Sunday to SUNDAY, not to index 0 of a Monday-first list', () => {
    expect(dayKeyFor(new Date('2026-08-09T10:00:00'))).toBe('SUNDAY');
  });
  it('maps a Monday to MONDAY', () => {
    expect(dayKeyFor(new Date('2026-08-03T10:00:00'))).toBe('MONDAY');
  });
  it('maps a Thursday to THURSDAY', () => {
    expect(dayKeyFor(new Date('2026-08-06T10:00:00'))).toBe('THURSDAY');
  });
});

describe('cellAt / isFilled', () => {
  it('finds a cell by day and slot', () => {
    expect(cellAt(fullWeek, 'THURSDAY', 'lunch')?.item_name).toBe('LUNCH item');
  });
  it('returns null for a missing cell', () => {
    expect(cellAt(toWeekGrid([]), 'MONDAY', 'lunch')).toBeNull();
  });
  it('treats a null menu_item_id as unfilled', () => {
    expect(isFilled({ id: 'x', day_of_week: 'MONDAY', meal_type: 'snacks', menu_item_id: null, item_name: 'Not set' })).toBe(false);
  });
  it('treats the literal "Not set" name as unfilled even with an id', () => {
    expect(isFilled({ id: 'x', day_of_week: 'MONDAY', meal_type: 'snacks', menu_item_id: 'i1', item_name: 'Not set' })).toBe(false);
  });
  it('treats a real item as filled', () => {
    expect(isFilled({ id: 'x', day_of_week: 'MONDAY', meal_type: 'lunch', menu_item_id: 'i1', item_name: 'Dosa' })).toBe(true);
  });
  it('treats null as unfilled', () => {
    expect(isFilled(null)).toBe(false);
  });
});

describe('dayCompleteness', () => {
  it('is COMPLETE when all four meals are filled', () => {
    expect(dayCompleteness(fullWeek, 'MONDAY')).toBe('COMPLETE');
  });
  it('is PARTIAL when some meals are filled', () => {
    const grid = toWeekGrid([raw('MONDAY', 'BREAKFAST', 'Dosa'), raw('MONDAY', 'SNACKS', 'Not set', null)]);
    expect(dayCompleteness(grid, 'MONDAY')).toBe('PARTIAL');
  });
  it('is EMPTY when nothing is filled', () => {
    const grid = toWeekGrid([raw('MONDAY', 'SNACKS', 'Not set', null)]);
    expect(dayCompleteness(grid, 'MONDAY')).toBe('EMPTY');
  });
  it('is EMPTY when the day has no cells at all', () => {
    expect(dayCompleteness(toWeekGrid([]), 'MONDAY')).toBe('EMPTY');
  });
});

describe('mealSlotAt', () => {
  it('shows breakfast as current in the early morning', () => {
    expect(mealSlotAt(new Date('2026-08-06T07:40:00'))).toEqual({ current: 'breakfast', next: 'lunch' });
  });
  it('shows lunch as current in the early afternoon', () => {
    expect(mealSlotAt(new Date('2026-08-06T13:30:00'))).toEqual({ current: 'lunch', next: 'snacks' });
  });
  it('shows dinner as current in the evening with nothing after it', () => {
    expect(mealSlotAt(new Date('2026-08-06T20:30:00'))).toEqual({ current: 'dinner', next: null });
  });
  it('after midnight and before breakfast, breakfast is still what is coming', () => {
    expect(mealSlotAt(new Date('2026-08-06T02:00:00'))).toEqual({ current: 'breakfast', next: 'lunch' });
  });
  it('exposes meal times in ascending hour order', () => {
    const hours = (['breakfast', 'lunch', 'snacks', 'dinner'] as const).map((s) => MEAL_TIMES[s].hour);
    expect(hours).toEqual([...hours].sort((a, b) => a - b));
  });
});
