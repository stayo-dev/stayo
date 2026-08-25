import { describe, expect, it } from 'vitest';
import { buildPublishChecks, canPublish } from './publishChecks';
import { toWeekGrid, DAY_ORDER } from './weekGrid';

let nextItemId = 0;
function mealItem(name: string, menuItemId: string | null = 'i1', displayOrder = 0) {
  return { id: `item-${nextItemId++}`, menu_item_id: menuItemId, item_name: name, display_order: displayOrder };
}
const cell = (day: string, meal: string, items: ReturnType<typeof mealItem>[]) => ({
  id: `${day}-${meal}`, day_of_week: day, meal_type: meal, food_schedule_meal_items: items,
});

/** A full week where each meal type cycles through 4 distinct items. */
const variedWeek = toWeekGrid(
  DAY_ORDER.flatMap((d, i) =>
    ['BREAKFAST', 'LUNCH', 'SNACKS', 'DINNER'].map((m) => cell(d, m, [mealItem(`${m}-${i % 4}`, `id-${m}-${i % 4}`)])),
  ),
);

const check = (result: ReturnType<typeof buildPublishChecks>, id: string) => result.checks.find((c) => c.id === id)!;

describe('buildPublishChecks', () => {
  it('passes completeness on a full week', () => {
    const result = buildPublishChecks({ grid: variedWeek });
    expect(check(result, 'complete').status).toBe('PASS');
    expect(check(result, 'complete').label).toMatch(/28/);
    expect(result.incompleteCells).toEqual([]);
  });

  it('warns with a count when meals are missing', () => {
    const grid = toWeekGrid(
      DAY_ORDER.flatMap((d) => [
        cell(d, 'BREAKFAST', [mealItem('Dosa')]), cell(d, 'LUNCH', [mealItem('Rice')]),
        cell(d, 'DINNER', [mealItem('Chapati')]), cell(d, 'SNACKS', []),
      ]),
    );
    const result = buildPublishChecks({ grid });
    expect(check(result, 'complete').status).toBe('WARN');
    expect(check(result, 'complete').label).toMatch(/21 of 28/);
  });

  it('does not call an empty schedule complete', () => {
    const result = buildPublishChecks({ grid: [] });
    const c = check(result, 'complete');
    expect(c.status).toBe('WARN');
    expect(c.label).toMatch(/0 of 28/);
  });

  it('names every individual empty day+meal cell, not just which meal types are empty all week', () => {
    const grid = toWeekGrid(
      DAY_ORDER.flatMap((d) => [
        cell(d, 'BREAKFAST', [mealItem('Dosa')]), cell(d, 'LUNCH', [mealItem('Rice')]),
        cell(d, 'DINNER', [mealItem('Chapati')]), cell(d, 'SNACKS', []),
      ]),
    );
    const result = buildPublishChecks({ grid });
    expect(result.incompleteCells).toHaveLength(7);
    expect(result.incompleteCells.every((c) => c.slot === 'snacks')).toBe(true);
    expect(result.incompleteCells.map((c) => c.label)).toContain('Monday Snacks');
  });

  it('reports exactly one incomplete cell for a single missing meal', () => {
    const grid = toWeekGrid(
      DAY_ORDER.flatMap((d) => ['BREAKFAST', 'LUNCH', 'SNACKS', 'DINNER'].map((m) => cell(d, m, [mealItem(`${m} item`)]))).filter(
        (row) => !(row.day_of_week === 'MONDAY' && row.meal_type === 'DINNER'),
      ),
    );
    const result = buildPublishChecks({ grid });
    expect(result.incompleteCells).toEqual([{ day: 'MONDAY', slot: 'dinner', label: 'Monday Dinner' }]);
  });

  it('warns when one item dominates a meal type', () => {
    const grid = toWeekGrid(DAY_ORDER.flatMap((d) => [cell(d, 'BREAKFAST', [mealItem('Dosa', 'dosa')])]));
    const c = check(buildPublishChecks({ grid }), 'variety');
    expect(c.status).toBe('WARN');
    expect(c.label).toMatch(/Dosa/);
    expect(c.label).toMatch(/7 of 7/);
  });

  it('names EVERY dominated meal type, not just the worst one', () => {
    const grid = toWeekGrid(
      DAY_ORDER.flatMap((d) => [cell(d, 'BREAKFAST', [mealItem('Dosa', 'dosa')]), cell(d, 'LUNCH', [mealItem('Sambar Rice', 'sr')])]),
    );
    const c = check(buildPublishChecks({ grid }), 'variety');
    expect(c.status).toBe('WARN');
    expect(c.label).toMatch(/Dosa/);
    expect(c.label).toMatch(/Sambar Rice/);
  });

  it('passes variety when no item exceeds 3 of 7 days', () => {
    expect(check(buildPublishChecks({ grid: variedWeek }), 'variety').status).toBe('PASS');
  });

  it('treats the same multi-item combination on every day as dominant, counted as one combination not several', () => {
    const grid = toWeekGrid(DAY_ORDER.flatMap((d) => [cell(d, 'LUNCH', [mealItem('Rice', 'r', 0), mealItem('Dal', 'd', 1)])]));
    const c = check(buildPublishChecks({ grid }), 'variety');
    expect(c.status).toBe('WARN');
    expect(c.label).toMatch(/Rice • Dal/);
    expect(c.label).toMatch(/7 of 7/);
  });

  it('treats the same dishes in a different order as the same combination — a reorder does not dodge the dominance warning', () => {
    const grid = toWeekGrid(
      DAY_ORDER.map((d, i) =>
        cell(d, 'LUNCH', i % 2 === 0
          ? [mealItem('Rice', 'r', 0), mealItem('Dal', 'd', 1)]
          : [mealItem('Dal', 'd', 0), mealItem('Rice', 'r', 1)]),
      ),
    );
    const c = check(buildPublishChecks({ grid }), 'variety');
    expect(c.status).toBe('WARN');
    expect(c.label).toMatch(/7 of 7/);
  });

  it('warns when the same item runs on consecutive days', () => {
    const grid = toWeekGrid([
      cell('MONDAY', 'LUNCH', [mealItem('Rice', 'r')]), cell('TUESDAY', 'LUNCH', [mealItem('Rice', 'r')]),
      cell('WEDNESDAY', 'LUNCH', [mealItem('Dal', 'd')]), cell('THURSDAY', 'LUNCH', [mealItem('Curd', 'c')]),
      cell('FRIDAY', 'LUNCH', [mealItem('Dal', 'd')]), cell('SATURDAY', 'LUNCH', [mealItem('Curd', 'c')]),
      cell('SUNDAY', 'LUNCH', [mealItem('Dal', 'd')]),
    ]);
    expect(check(buildPublishChecks({ grid }), 'runs').status).toBe('WARN');
  });

  it('passes the consecutive-days check when nothing repeats back to back', () => {
    expect(check(buildPublishChecks({ grid: variedWeek }), 'runs').status).toBe('PASS');
  });

  it('warns when the same item runs across the Sunday-to-Monday wrap', () => {
    // The week repeats all month, so Sunday lunch is followed by Monday lunch.
    const grid = toWeekGrid([
      cell('MONDAY', 'LUNCH', [mealItem('Sambar Rice', 'sr')]), cell('TUESDAY', 'LUNCH', [mealItem('Dal', 'd')]),
      cell('WEDNESDAY', 'LUNCH', [mealItem('Curd', 'c')]), cell('THURSDAY', 'LUNCH', [mealItem('Dal', 'd')]),
      cell('FRIDAY', 'LUNCH', [mealItem('Curd', 'c')]), cell('SATURDAY', 'LUNCH', [mealItem('Dal', 'd')]),
      cell('SUNDAY', 'LUNCH', [mealItem('Sambar Rice', 'sr')]),
    ]);
    expect(check(buildPublishChecks({ grid }), 'runs').status).toBe('WARN');
  });

  it('does not treat two different empty meals as a repeat', () => {
    const grid = toWeekGrid([cell('MONDAY', 'SNACKS', []), cell('TUESDAY', 'SNACKS', [])]);
    expect(check(buildPublishChecks({ grid }), 'runs').status).toBe('PASS');
  });

  it('warns when the same multi-item combination runs on consecutive days, even reordered', () => {
    const grid = toWeekGrid([
      cell('MONDAY', 'LUNCH', [mealItem('Rice', 'r', 0), mealItem('Dal', 'd', 1)]),
      cell('TUESDAY', 'LUNCH', [mealItem('Dal', 'd', 0), mealItem('Rice', 'r', 1)]),
    ]);
    expect(check(buildPublishChecks({ grid }), 'runs').status).toBe('WARN');
  });

  it('variety and runs only ever return PASS or WARN — neither can gate the publish button', () => {
    const grid = toWeekGrid([cell('MONDAY', 'SNACKS', [])]);
    const result = buildPublishChecks({ grid });
    for (const id of ['variety', 'runs']) {
      expect(['PASS', 'WARN']).toContain(check(result, id).status);
    }
  });

  it('returns a stable set of three checks in a stable order', () => {
    const ids = buildPublishChecks({ grid: variedWeek }).checks.map((c) => c.id);
    expect(ids).toEqual(['complete', 'variety', 'runs']);
  });
});

describe('canPublish', () => {
  it('is true when there are no incomplete cells', () => {
    expect(canPublish(buildPublishChecks({ grid: variedWeek }))).toBe(true);
  });

  it('is false when any cell is incomplete — this is what actually gates the Publish button', () => {
    const grid = toWeekGrid([cell('MONDAY', 'SNACKS', [])]);
    expect(canPublish(buildPublishChecks({ grid }))).toBe(false);
  });

  it('is false for a brand-new, fully empty schedule', () => {
    expect(canPublish(buildPublishChecks({ grid: [] }))).toBe(false);
  });
});
