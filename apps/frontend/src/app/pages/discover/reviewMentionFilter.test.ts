import { describe, expect, it } from 'vitest';
import type { HostelReview } from '@features/discover/api';

import { buildMentionChips, filterReviewsByMention, reviewMatchesMention } from './reviewMentionFilter';

function review(overrides: Partial<HostelReview> = {}): HostelReview {
  return {
    id: 'r1',
    rating: 5,
    body: null,
    stayed_here: true,
    stay_duration: null,
    created_at: '2026-01-01T00:00:00.000Z',
    author: 'Sharan K.',
    categories: [],
    ...overrides,
  };
}

describe('buildMentionChips', () => {
  it('resolves known highlight labels back to their category key', () => {
    const chips = buildMentionChips([
      { label: 'Clean Rooms', count: 5 },
      { label: 'Good Wi-Fi', count: 3 },
    ]);
    expect(chips).toEqual([
      { key: 'cleanliness', label: 'Clean Rooms', count: 5 },
      { key: 'wifi', label: 'Good Wi-Fi', count: 3 },
    ]);
  });

  it('drops an unresolvable label defensively rather than showing a dead filter', () => {
    const chips = buildMentionChips([
      { label: 'Clean Rooms', count: 5 },
      { label: 'Not A Real Highlight', count: 1 },
    ]);
    expect(chips).toEqual([{ key: 'cleanliness', label: 'Clean Rooms', count: 5 }]);
  });

  it('returns an empty array for no highlights', () => {
    expect(buildMentionChips([])).toEqual([]);
  });
});

describe('reviewMatchesMention', () => {
  it('matches a category rated 4 or 5', () => {
    const r = review({ categories: [{ key: 'cleanliness', label: 'Cleanliness', rating: 4 }] });
    expect(reviewMatchesMention(r, 'cleanliness')).toBe(true);
  });

  it('does not match a category rated below 4', () => {
    const r = review({ categories: [{ key: 'cleanliness', label: 'Cleanliness', rating: 3 }] });
    expect(reviewMatchesMention(r, 'cleanliness')).toBe(false);
  });

  it('does not match a key the review has no category entry for', () => {
    const r = review({ categories: [{ key: 'wifi', label: 'Wi-Fi', rating: 5 }] });
    expect(reviewMatchesMention(r, 'cleanliness')).toBe(false);
  });
});

describe('filterReviewsByMention', () => {
  it('passes everything through when key is null', () => {
    const reviews = [review({ id: 'a' }), review({ id: 'b' })];
    expect(filterReviewsByMention(reviews, null)).toEqual(reviews);
  });

  it('filters to only reviews matching the given category at >=4', () => {
    const reviews = [
      review({ id: 'a', categories: [{ key: 'cleanliness', label: 'Cleanliness', rating: 5 }] }),
      review({ id: 'b', categories: [{ key: 'cleanliness', label: 'Cleanliness', rating: 2 }] }),
      review({ id: 'c', categories: [{ key: 'wifi', label: 'Wi-Fi', rating: 5 }] }),
    ];
    expect(filterReviewsByMention(reviews, 'cleanliness').map((r) => r.id)).toEqual(['a']);
  });
});
