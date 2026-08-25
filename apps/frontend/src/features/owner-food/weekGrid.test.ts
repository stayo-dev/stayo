import { describe, expect, it } from 'vitest';
import {
  toWeekGrid, dayKeyFor, cellAt, isFilled, dayCompleteness, formatCellItems, sameItemSet, itemSetKey, EMPTY_CELL_LABEL,
  type WeekGrid,
} from './weekGrid';

let nextItemId = 0;
function mealItem(name: string, menuItemId: string | null = 'i1', displayOrder = 0) {
  return { id: `item-${nextItemId++}`, menu_item_id: menuItemId, item_name: name, display_order: displayOrder };
}

/** One `food_schedule_meals` row as the API returns it — a day/meal cell with an ordered `food_schedule_meal_items` array. */
const raw = (day: string, meal: string, items: ReturnType<typeof mealItem>[]) => ({
  id: `${day}-${meal}`, day_of_week: day, meal_type: meal, food_schedule_meal_items: items,
});

const fullWeek: WeekGrid = toWeekGrid(
  ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'].flatMap((d) =>
    ['BREAKFAST', 'LUNCH', 'SNACKS', 'DINNER'].map((m) => raw(d, m, [mealItem(`${m} item`, `id-${m}`)])),
  ),
);

describe('toWeekGrid', () => {
  it('lowercases meal_type into the slot key used across the app', () => {
    const grid = toWeekGrid([raw('MONDAY', 'BREAKFAST', [mealItem('Dosa')])]);
    expect(grid[0].meal_type).toBe('breakfast');
  });

  it('returns an empty grid for null/undefined input', () => {
    expect(toWeekGrid(undefined)).toEqual([]);
    expect(toWeekGrid(null)).toEqual([]);
  });

  it('drops rows with an unrecognised day or meal type rather than corrupting the grid', () => {
    const grid = toWeekGrid([raw('FUNDAY', 'BREAKFAST', [mealItem('X')]), raw('MONDAY', 'BRUNCH', [mealItem('Y')])]);
    expect(grid).toEqual([]);
  });

  it('sorts items by display_order regardless of input order', () => {
    const grid = toWeekGrid([raw('MONDAY', 'LUNCH', [mealItem('Chutney', 'c', 3), mealItem('Rice', 'r', 0), mealItem('Dal', 'd', 1)])]);
    expect(grid[0].items.map((i) => i.item_name)).toEqual(['Rice', 'Dal', 'Chutney']);
  });

  it('produces an empty items array for a cell with no child rows', () => {
    const grid = toWeekGrid([raw('MONDAY', 'SNACKS', [])]);
    expect(grid[0].items).toEqual([]);
  });

  it('a single-item meal (e.g. migrated pre-multi-item data) carries exactly one item', () => {
    const grid = toWeekGrid([raw('MONDAY', 'LUNCH', [mealItem('Sambar', 'sambar-id', 0)])]);
    expect(grid[0].items).toHaveLength(1);
    expect(grid[0].items[0].item_name).toBe('Sambar');
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
    expect(cellAt(fullWeek, 'THURSDAY', 'lunch')?.items[0].item_name).toBe('LUNCH item');
  });
  it('returns null for a missing cell', () => {
    expect(cellAt(toWeekGrid([]), 'MONDAY', 'lunch')).toBeNull();
  });
  it('treats a cell with no items as unfilled', () => {
    const grid = toWeekGrid([raw('MONDAY', 'SNACKS', [])]);
    expect(isFilled(grid[0])).toBe(false);
  });
  it('treats a single real item as filled', () => {
    const grid = toWeekGrid([raw('MONDAY', 'LUNCH', [mealItem('Dosa')])]);
    expect(isFilled(grid[0])).toBe(true);
  });
  it('treats multiple items as filled', () => {
    const grid = toWeekGrid([raw('MONDAY', 'LUNCH', [mealItem('Rice', 'r'), mealItem('Dal', 'd'), mealItem('Curry', 'c'), mealItem('Chutney', 'ch')])]);
    expect(isFilled(grid[0])).toBe(true);
    expect(grid[0].items).toHaveLength(4);
  });
  it('treats null as unfilled', () => {
    expect(isFilled(null)).toBe(false);
  });
});

describe('formatCellItems', () => {
  it('joins multiple items with the shared separator, in display order', () => {
    const grid = toWeekGrid([raw('MONDAY', 'LUNCH', [mealItem('Rice', 'r', 0), mealItem('Dal', 'd', 1), mealItem('Curry', 'c', 2), mealItem('Chutney', 'ch', 3)])]);
    expect(formatCellItems(grid[0])).toBe('Rice • Dal • Curry • Chutney');
  });
  it('returns the single item name for a one-item cell — same as pre-migration display', () => {
    const grid = toWeekGrid([raw('MONDAY', 'LUNCH', [mealItem('Sambar')])]);
    expect(formatCellItems(grid[0])).toBe('Sambar');
  });
  it('returns the shared empty label for a cell with zero items', () => {
    const grid = toWeekGrid([raw('MONDAY', 'SNACKS', [])]);
    expect(formatCellItems(grid[0])).toBe(EMPTY_CELL_LABEL);
  });
  it('returns the shared empty label for a null/undefined cell without throwing', () => {
    expect(formatCellItems(null)).toBe(EMPTY_CELL_LABEL);
    expect(formatCellItems(undefined)).toBe(EMPTY_CELL_LABEL);
  });
  it('accepts a custom separator', () => {
    const grid = toWeekGrid([raw('MONDAY', 'LUNCH', [mealItem('Rice', 'r', 0), mealItem('Dal', 'd', 1)])]);
    expect(formatCellItems(grid[0], ', ')).toBe('Rice, Dal');
  });
});

describe('itemSetKey / sameItemSet', () => {
  it('is order-independent — the same dishes in a different order match', () => {
    const a = toWeekGrid([raw('MONDAY', 'LUNCH', [mealItem('Rice', 'r', 0), mealItem('Dal', 'd', 1)])])[0];
    const b = toWeekGrid([raw('TUESDAY', 'LUNCH', [mealItem('Dal', 'd', 0), mealItem('Rice', 'r', 1)])])[0];
    expect(sameItemSet(a, b)).toBe(true);
  });
  it('is false when the dish sets differ', () => {
    const a = toWeekGrid([raw('MONDAY', 'LUNCH', [mealItem('Rice', 'r')])])[0];
    const b = toWeekGrid([raw('TUESDAY', 'LUNCH', [mealItem('Dal', 'd')])])[0];
    expect(sameItemSet(a, b)).toBe(false);
  });
  it('is false when one side is empty', () => {
    const a = toWeekGrid([raw('MONDAY', 'LUNCH', [mealItem('Rice', 'r')])])[0];
    const b = toWeekGrid([raw('TUESDAY', 'LUNCH', [])])[0];
    expect(sameItemSet(a, b)).toBe(false);
  });
  it('gives every empty cell the same key, so two empties never look like a repeating meal', () => {
    const a = toWeekGrid([raw('MONDAY', 'SNACKS', [])])[0];
    const b = toWeekGrid([raw('TUESDAY', 'SNACKS', [])])[0];
    expect(itemSetKey(a)).toBe(itemSetKey(b));
    expect(sameItemSet(a, b)).toBe(false);
  });
});

describe('dayCompleteness', () => {
  it('is COMPLETE when all four meals are filled', () => {
    expect(dayCompleteness(fullWeek, 'MONDAY')).toBe('COMPLETE');
  });
  it('is PARTIAL when some meals are filled', () => {
    const grid = toWeekGrid([raw('MONDAY', 'BREAKFAST', [mealItem('Dosa')]), raw('MONDAY', 'SNACKS', [])]);
    expect(dayCompleteness(grid, 'MONDAY')).toBe('PARTIAL');
  });
  it('is EMPTY when nothing is filled', () => {
    const grid = toWeekGrid([raw('MONDAY', 'SNACKS', [])]);
    expect(dayCompleteness(grid, 'MONDAY')).toBe('EMPTY');
  });
  it('is EMPTY when the day has no cells at all', () => {
    expect(dayCompleteness(toWeekGrid([]), 'MONDAY')).toBe('EMPTY');
  });
});

// `mealSlotAt`/`MEAL_TIMES` moved to `features/food/mealTimings.ts`
// (`currentAndNextMeal`, real per-hostel timings) — see that file's own tests.
