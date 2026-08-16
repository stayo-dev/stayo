import { describe, it, expect } from 'vitest';
import { resolveListingTab, listingFilterFor, LISTING_TABS } from './listingTabs';

describe('resolveListingTab', () => {
  it('defaults to pending, which is the queue that needs work', () => {
    expect(resolveListingTab(null)).toBe('pending');
    expect(resolveListingTab('')).toBe('pending');
  });

  it('accepts the four known tabs', () => {
    expect(resolveListingTab('pending')).toBe('pending');
    expect(resolveListingTab('approved')).toBe('approved');
    expect(resolveListingTab('rejected')).toBe('rejected');
    expect(resolveListingTab('content')).toBe('content');
  });

  it('falls back to pending for an unknown tab rather than rendering nothing', () => {
    expect(resolveListingTab('nonsense')).toBe('pending');
  });

  it('exposes the content tab, so the old marketing-reviews link lands somewhere real', () => {
    expect(LISTING_TABS.map((t) => t.key)).toContain('content');
  });
});

describe('listingFilterFor', () => {
  it('maps each hostel tab to its API verification filter', () => {
    expect(listingFilterFor('pending')).toEqual({ verification: 'PENDING' });
    expect(listingFilterFor('approved')).toEqual({ verification: 'VERIFIED' });
    expect(listingFilterFor('rejected')).toEqual({ verification: 'REJECTED' });
  });

  it('returns null for the content tab, which reads marketing revisions instead', () => {
    expect(listingFilterFor('content')).toBeNull();
  });
});
