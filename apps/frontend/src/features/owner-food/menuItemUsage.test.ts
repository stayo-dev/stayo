import { describe, it, expect } from 'vitest';
import { countItemUsage, describeItemUsage } from './menuItemUsage';
import type { WeekGrid } from './weekGrid';

const cell = (...ids: (string | null)[]) =>
  ({ items: ids.map((menu_item_id) => ({ menu_item_id })) }) as unknown as WeekGrid[number];

describe('countItemUsage', () => {
  it('counts the cells holding the dish, not the number of times it appears', () => {
    const grid = [cell('a', 'b'), cell('b'), cell('a'), cell()] as WeekGrid;
    expect(countItemUsage(grid, 'a')).toBe(2);
    expect(countItemUsage(grid, 'b')).toBe(2);
  });

  it('is zero for a dish that is in the list but not in the plan', () => {
    expect(countItemUsage([cell('a')] as WeekGrid, 'z')).toBe(0);
  });

  it('survives an empty or malformed grid rather than blocking the removal', () => {
    expect(countItemUsage([] as WeekGrid, 'a')).toBe(0);
    expect(countItemUsage(undefined as unknown as WeekGrid, 'a')).toBe(0);
    expect(countItemUsage([{} as WeekGrid[number]] as WeekGrid, 'a')).toBe(0);
  });

  it('ignores free-text items, which carry no menu_item_id', () => {
    expect(countItemUsage([cell(null, 'a')] as WeekGrid, 'a')).toBe(1);
  });

  it('never matches an empty id, which would count every free-text cell', () => {
    expect(countItemUsage([cell(null), cell(null)] as WeekGrid, '')).toBe(0);
  });
});

describe('describeItemUsage', () => {
  it('says nothing when the dish is not in this month', () => {
    expect(describeItemUsage(0)).toBeNull();
    expect(describeItemUsage(-1)).toBeNull();
  });

  it('promises the planned meals are untouched, because they genuinely are', () => {
    // The removal is a soft delete; without saying so the owner assumes they
    // are about to blank four cells of their week.
    const text = describeItemUsage(4) ?? '';
    expect(text).toContain('4 meals');
    expect(text).toContain('stay exactly as they are');
  });

  it('does not say "1 meals"', () => {
    expect(describeItemUsage(1)).toContain('1 meal ');
  });
});
