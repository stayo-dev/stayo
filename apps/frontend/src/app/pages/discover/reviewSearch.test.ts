import { describe, expect, it } from 'vitest';
import type { HostelReview } from '@features/discover/api';

import { searchReviews } from './reviewSearch';

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

describe('searchReviews', () => {
  it('returns everything for an empty or whitespace-only query', () => {
    const reviews = [review({ id: 'a', body: 'Great place' }), review({ id: 'b', body: null })];
    expect(searchReviews(reviews, '')).toEqual(reviews);
    expect(searchReviews(reviews, '   ')).toEqual(reviews);
  });

  it('matches a case-insensitive substring of the body', () => {
    const reviews = [
      review({ id: 'a', body: 'The Wi-Fi was excellent throughout' }),
      review({ id: 'b', body: 'Food could be better' }),
    ];
    expect(searchReviews(reviews, 'wifi')).toEqual([]);
    expect(searchReviews(reviews, 'Wi-Fi')).toEqual([reviews[0]]);
    expect(searchReviews(reviews, 'FOOD')).toEqual([reviews[1]]);
  });

  it('never matches a review with a null body against a non-empty query', () => {
    const reviews = [review({ id: 'a', body: null })];
    expect(searchReviews(reviews, 'anything')).toEqual([]);
  });
});
