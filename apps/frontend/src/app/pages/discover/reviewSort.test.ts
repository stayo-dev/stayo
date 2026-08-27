import { describe, expect, it } from 'vitest';
import type { HostelReview } from '@features/discover/api';

import { sortReviews } from './reviewSort';

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

describe('sortReviews', () => {
  it('does not mutate the input array', () => {
    const reviews = [
      review({ id: 'a', rating: 3, created_at: '2026-01-01T00:00:00.000Z' }),
      review({ id: 'b', rating: 5, created_at: '2026-02-01T00:00:00.000Z' }),
    ];
    const original = [...reviews];
    sortReviews(reviews, 'highest');
    expect(reviews).toEqual(original);
    expect(reviews.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('"relevant" returns the input order unchanged', () => {
    const reviews = [review({ id: 'a' }), review({ id: 'b' }), review({ id: 'c' })];
    expect(sortReviews(reviews, 'relevant').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('"newest" sorts by created_at descending', () => {
    const reviews = [
      review({ id: 'old', created_at: '2026-01-01T00:00:00.000Z' }),
      review({ id: 'new', created_at: '2026-03-01T00:00:00.000Z' }),
      review({ id: 'mid', created_at: '2026-02-01T00:00:00.000Z' }),
    ];
    expect(sortReviews(reviews, 'newest').map((r) => r.id)).toEqual(['new', 'mid', 'old']);
  });

  it('"highest" sorts by rating descending, tie-broken by newest', () => {
    const reviews = [
      review({ id: 'low', rating: 2, created_at: '2026-01-01T00:00:00.000Z' }),
      review({ id: 'high-old', rating: 5, created_at: '2026-01-01T00:00:00.000Z' }),
      review({ id: 'high-new', rating: 5, created_at: '2026-02-01T00:00:00.000Z' }),
    ];
    expect(sortReviews(reviews, 'highest').map((r) => r.id)).toEqual(['high-new', 'high-old', 'low']);
  });

  it('"lowest" sorts by rating ascending, tie-broken by newest', () => {
    const reviews = [
      review({ id: 'high', rating: 5, created_at: '2026-01-01T00:00:00.000Z' }),
      review({ id: 'low-old', rating: 1, created_at: '2026-01-01T00:00:00.000Z' }),
      review({ id: 'low-new', rating: 1, created_at: '2026-02-01T00:00:00.000Z' }),
    ];
    expect(sortReviews(reviews, 'lowest').map((r) => r.id)).toEqual(['low-new', 'low-old', 'high']);
  });
});
