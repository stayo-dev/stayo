import { describe, it, expect } from 'vitest';
import { findFocusedItem } from './workQueueFocus';
import type { WorkQueueSection } from './WorkQueue';

const item = (id: string) => ({ id, title: id, subtitle: '', actions: [] });
const sections = [
  { id: 's1', label: '', Icon: () => null, tone: '', items: [item('a'), item('b')] },
  { id: 's2', label: '', Icon: () => null, tone: '', items: [item('c')] },
] as unknown as WorkQueueSection[];

describe('findFocusedItem', () => {
  it('returns null when nothing is focused', () => {
    expect(findFocusedItem(sections, null)).toBeNull();
    expect(findFocusedItem(sections, undefined)).toBeNull();
    expect(findFocusedItem(sections, '')).toBeNull();
  });

  it('finds an item across sections', () => {
    expect(findFocusedItem(sections, 'a')?.id).toBe('a');
    expect(findFocusedItem(sections, 'c')?.id).toBe('c');
  });

  it('returns null for a stale / unknown id (row cleared, or wrong queue)', () => {
    expect(findFocusedItem(sections, 'zzz')).toBeNull();
    expect(findFocusedItem([], 'a')).toBeNull();
  });
});
