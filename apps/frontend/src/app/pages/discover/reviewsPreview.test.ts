import { describe, expect, it } from 'vitest';

import { getReviewPreview, REVIEW_PREVIEW_COUNT } from './reviewsPreview';

describe('getReviewPreview', () => {
  it('returns an empty array unchanged', () => {
    expect(getReviewPreview([], false)).toEqual([]);
    expect(getReviewPreview([], true)).toEqual([]);
  });

  it('returns everything when there are fewer than the preview count', () => {
    const reviews = [1, 2];
    expect(getReviewPreview(reviews, false)).toEqual([1, 2]);
  });

  it('returns everything when there are exactly the preview count', () => {
    const reviews = [1, 2, 3, 4];
    expect(getReviewPreview(reviews, false)).toEqual([1, 2, 3, 4]);
  });

  it('truncates to the preview count when there are more and showAll is false', () => {
    const reviews = [1, 2, 3, 4, 5, 6];
    expect(getReviewPreview(reviews, false)).toEqual([1, 2, 3, 4]);
    expect(getReviewPreview(reviews, false).length).toBe(REVIEW_PREVIEW_COUNT);
  });

  it('returns everything when showAll is true, regardless of count', () => {
    const reviews = [1, 2, 3, 4, 5, 6];
    expect(getReviewPreview(reviews, true)).toEqual(reviews);
  });

  it('honours a custom previewCount override', () => {
    const reviews = [1, 2, 3, 4, 5, 6];
    expect(getReviewPreview(reviews, false, 2)).toEqual([1, 2]);
    expect(getReviewPreview(reviews, false, 10)).toEqual(reviews);
  });
});
