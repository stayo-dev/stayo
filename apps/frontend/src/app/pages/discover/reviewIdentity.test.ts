import { describe, expect, it } from 'vitest';

import { reviewerInitials } from './reviewIdentity';

describe('reviewerInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(reviewerInitials('Sharan K.')).toBe('SK');
  });

  it('handles a single-word name', () => {
    expect(reviewerInitials('Sharan')).toBe('S');
  });

  it('ignores extra words beyond the first two', () => {
    expect(reviewerInitials('Sharan Kumar Reddy')).toBe('SK');
  });

  it('falls back to "S" for empty, missing or whitespace-only input', () => {
    expect(reviewerInitials('')).toBe('S');
    expect(reviewerInitials('   ')).toBe('S');
    expect(reviewerInitials(undefined)).toBe('S');
    expect(reviewerInitials(null)).toBe('S');
  });

  it('uppercases the result', () => {
    expect(reviewerInitials('sharan k.')).toBe('SK');
  });
});
