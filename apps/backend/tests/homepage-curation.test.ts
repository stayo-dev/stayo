import { describe, expect, it } from 'vitest';
import { applyCuration, normaliseLineup, MAX_FEATURED } from '@/src/services/discovery/homepage-curation';

const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('applyCuration', () => {
  it('leaves the default sort alone when nothing is curated', () => {
    const result = applyCuration(cards, []);
    expect(result.cards).toEqual(cards);
    expect(result.curated).toBe(false);
  });

  it('returns exactly the curated hostels, in the curated order', () => {
    const result = applyCuration(cards, ['c', 'a']);
    expect(result.cards.map((c) => c.id)).toEqual(['c', 'a']);
    expect(result.curated).toBe(true);
  });

  it('drops a curated hostel that is no longer discoverable, and says which', () => {
    const result = applyCuration(cards, ['c', 'gone', 'a']);
    expect(result.cards.map((c) => c.id)).toEqual(['c', 'a']);
    expect(result.droppedIds).toEqual(['gone']);
  });

  it('falls back to the default sort when every curated hostel has gone', () => {
    const result = applyCuration(cards, ['gone', 'also-gone']);
    expect(result.cards).toEqual(cards);
    expect(result.curated).toBe(false);
    expect(result.droppedIds).toEqual(['gone', 'also-gone']);
  });

  it('never invents a hostel that was not discoverable', () => {
    expect(applyCuration([], ['a']).cards).toEqual([]);
  });
});

describe('normaliseLineup', () => {
  it('keeps the order the admin sent', () => {
    expect(normaliseLineup(['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });

  it('dedupes and drops blanks and non-strings', () => {
    expect(normaliseLineup(['a', 'a', '  ', 42, null, 'b'])).toEqual(['a', 'b']);
  });

  it('trims ids', () => {
    expect(normaliseLineup([' a '])).toEqual(['a']);
  });

  it('caps the line-up', () => {
    const many = Array.from({ length: MAX_FEATURED + 5 }, (_, i) => `h${i}`);
    expect(normaliseLineup(many)).toHaveLength(MAX_FEATURED);
  });

  it('treats anything that is not a list as an empty line-up', () => {
    expect(normaliseLineup(null)).toEqual([]);
    expect(normaliseLineup('a,b')).toEqual([]);
  });
});
