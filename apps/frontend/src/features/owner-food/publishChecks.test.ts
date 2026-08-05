import { describe, expect, it } from 'vitest';
import { buildPublishChecks } from './publishChecks';
import { toWeekGrid, DAY_ORDER } from './weekGrid';

const cell = (day: string, meal: string, name: string, id: string | null = 'i1') => ({
  id: `${day}-${meal}`, day_of_week: day, meal_type: meal, menu_item_id: id, item_name: name,
});

/** A full week where each meal type cycles through 4 distinct items. */
const variedWeek = toWeekGrid(
  DAY_ORDER.flatMap((d, i) =>
    ['BREAKFAST', 'LUNCH', 'SNACKS', 'DINNER'].map((m) => cell(d, m, `${m}-${i % 4}`, `id-${m}-${i % 4}`)),
  ),
);

const check = (checks: ReturnType<typeof buildPublishChecks>, id: string) => checks.find((c) => c.id === id)!;

describe('buildPublishChecks', () => {
  it('passes completeness on a full week', () => {
    const checks = buildPublishChecks({ grid: variedWeek, votesConsidered: true, voterCount: 12 });
    expect(check(checks, 'complete').status).toBe('PASS');
    expect(check(checks, 'complete').label).toMatch(/28/);
  });

  it('warns with a count when meals are missing', () => {
    const grid = toWeekGrid(
      DAY_ORDER.flatMap((d) => [
        cell(d, 'BREAKFAST', 'Dosa'), cell(d, 'LUNCH', 'Rice'),
        cell(d, 'DINNER', 'Chapati'), cell(d, 'SNACKS', 'Not set', null),
      ]),
    );
    const checks = buildPublishChecks({ grid, votesConsidered: false, voterCount: 0 });
    expect(check(checks, 'complete').status).toBe('WARN');
    expect(check(checks, 'complete').label).toMatch(/21 of 28/);
  });

  it('does not call an empty schedule complete', () => {
    const c = check(buildPublishChecks({ grid: [], votesConsidered: false, voterCount: 0 }), 'complete');
    expect(c.status).toBe('WARN');
    expect(c.label).toMatch(/0 of 28/);
  });

  it('names the empty meal type so the owner knows where to look', () => {
    const grid = toWeekGrid(
      DAY_ORDER.flatMap((d) => [
        cell(d, 'BREAKFAST', 'Dosa'), cell(d, 'LUNCH', 'Rice'),
        cell(d, 'DINNER', 'Chapati'), cell(d, 'SNACKS', 'Not set', null),
      ]),
    );
    expect(check(buildPublishChecks({ grid, votesConsidered: false, voterCount: 0 }), 'complete').label)
      .toMatch(/snacks/i);
  });

  it('warns when one item dominates a meal type', () => {
    const grid = toWeekGrid(DAY_ORDER.flatMap((d) => [cell(d, 'BREAKFAST', 'Dosa', 'dosa')]));
    const c = check(buildPublishChecks({ grid, votesConsidered: false, voterCount: 0 }), 'variety');
    expect(c.status).toBe('WARN');
    expect(c.label).toMatch(/Dosa/);
    expect(c.label).toMatch(/7 of 7/);
  });

  it('passes variety when no item exceeds 3 of 7 days', () => {
    expect(check(buildPublishChecks({ grid: variedWeek, votesConsidered: true, voterCount: 1 }), 'variety').status).toBe('PASS');
  });

  it('warns when the same item runs on consecutive days', () => {
    const grid = toWeekGrid([
      cell('MONDAY', 'LUNCH', 'Rice', 'r'), cell('TUESDAY', 'LUNCH', 'Rice', 'r'),
      cell('WEDNESDAY', 'LUNCH', 'Dal', 'd'), cell('THURSDAY', 'LUNCH', 'Curd', 'c'),
      cell('FRIDAY', 'LUNCH', 'Dal', 'd'), cell('SATURDAY', 'LUNCH', 'Curd', 'c'),
      cell('SUNDAY', 'LUNCH', 'Dal', 'd'),
    ]);
    expect(check(buildPublishChecks({ grid, votesConsidered: false, voterCount: 0 }), 'runs').status).toBe('WARN');
  });

  it('passes the consecutive-days check when nothing repeats back to back', () => {
    expect(check(buildPublishChecks({ grid: variedWeek, votesConsidered: false, voterCount: 0 }), 'runs').status).toBe('PASS');
  });

  it('reports voting as considered with the voter count', () => {
    const c = check(buildPublishChecks({ grid: variedWeek, votesConsidered: true, voterCount: 12 }), 'votes');
    expect(c.status).toBe('PASS');
    expect(c.label).toMatch(/12/);
  });

  it('warns, never blocks, when nobody voted', () => {
    const c = check(buildPublishChecks({ grid: variedWeek, votesConsidered: false, voterCount: 0 }), 'votes');
    expect(c.status).toBe('WARN');
  });

  it('only ever returns PASS or WARN — no status can gate the publish button', () => {
    const grid = toWeekGrid([cell('MONDAY', 'SNACKS', 'Not set', null)]);
    for (const c of buildPublishChecks({ grid, votesConsidered: false, voterCount: 0 })) {
      expect(['PASS', 'WARN']).toContain(c.status);
    }
  });

  it('returns a stable set of four checks in a stable order', () => {
    const ids = buildPublishChecks({ grid: variedWeek, votesConsidered: true, voterCount: 3 }).map((c) => c.id);
    expect(ids).toEqual(['complete', 'variety', 'runs', 'votes']);
  });
});
