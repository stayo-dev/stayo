import { describe, expect, it } from 'vitest';
import { findDropTarget, isValidDrop, type DropCandidate } from './dragSwap';

const rect = (left: number, top: number) => ({ left, top, right: left + 100, bottom: top + 44 });
const candidates: DropCandidate[] = [
  { mealId: 'mon-b', mealType: 'breakfast', rect: rect(0, 0) },
  { mealId: 'tue-b', mealType: 'breakfast', rect: rect(0, 60) },
  { mealId: 'tue-d', mealType: 'dinner', rect: rect(120, 60) },
];

describe('findDropTarget', () => {
  it('finds the candidate whose rect contains the point', () => {
    expect(findDropTarget({ x: 50, y: 80 }, candidates)).toBe('tue-b');
  });

  it('returns null when the point is over nothing', () => {
    expect(findDropTarget({ x: 500, y: 500 }, candidates)).toBeNull();
  });

  it('is inclusive of the rect edges', () => {
    expect(findDropTarget({ x: 0, y: 0 }, candidates)).toBe('mon-b');
  });

  it('returns null for an empty candidate list', () => {
    expect(findDropTarget({ x: 10, y: 10 }, [])).toBeNull();
  });
});

describe('isValidDrop', () => {
  it('allows the same meal type on a different day', () => {
    expect(isValidDrop({ mealId: 'mon-b', mealType: 'breakfast' }, { mealId: 'tue-b', mealType: 'breakfast' })).toBe(true);
  });

  it('refuses a different meal type — breakfast can never become dinner', () => {
    expect(isValidDrop({ mealId: 'mon-b', mealType: 'breakfast' }, { mealId: 'tue-d', mealType: 'dinner' })).toBe(false);
  });

  it('refuses dropping onto itself', () => {
    expect(isValidDrop({ mealId: 'mon-b', mealType: 'breakfast' }, { mealId: 'mon-b', mealType: 'breakfast' })).toBe(false);
  });

  it('refuses a null target', () => {
    expect(isValidDrop({ mealId: 'mon-b', mealType: 'breakfast' }, null)).toBe(false);
  });
});
