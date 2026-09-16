import { describe, it, expect } from 'vitest';
import { buildAdminNav, isNavItemActive } from './adminNav';

describe('buildAdminNav', () => {
  it('returns the four design groups in order', () => {
    const groups = buildAdminNav({});
    expect(groups.map((g) => g.label)).toEqual(['Manage', 'Review', 'Business', 'Support']);
  });

  it('keeps Settings in the Support group even though the design omits it', () => {
    const support = buildAdminNav({}).find((g) => g.label === 'Support');
    expect(support?.items.map((i) => i.to)).toContain('/admin/settings');
  });

  it('omits a badge when the count is zero or missing', () => {
    const groups = buildAdminNav({ reviews: 0 });
    const reviews = groups.flatMap((g) => g.items).find((i) => i.to === '/admin/reviews');
    expect(reviews?.badge).toBe(0);
  });

  it('shows a badge when there is real work waiting', () => {
    expect(buildAdminNav({ reviews: 3 }).flatMap((g) => g.items).find((i) => i.to === '/admin/reviews')?.badge)
      .toBe(3);
  });

  it('exposes every screen the console routes to', () => {
    // 'Hostel Listings' dropped in v1 (ADR-170) — marketplace shelved.
    // 'KYC Approvals' removed from the console entirely.
    const paths = buildAdminNav({}).flatMap((g) => g.items).map((i) => i.to);
    expect(paths).toEqual([
      '/admin', '/admin/leads', '/admin/owners',
      '/admin/reviews',
      '/admin/revenue', '/admin/subscriptions',
      '/admin/reports', '/admin/broadcasts', '/admin/settings',
    ]);
  });
});

describe('isNavItemActive', () => {
  it('matches Overview only exactly, so it does not stay lit on every child route', () => {
    expect(isNavItemActive('/admin', '/admin', true)).toBe(true);
    expect(isNavItemActive('/admin', '/admin/leads', true)).toBe(false);
  });

  it('matches other items on their own path', () => {
    expect(isNavItemActive('/admin/leads', '/admin/leads')).toBe(true);
    expect(isNavItemActive('/admin/leads', '/admin/owners')).toBe(false);
  });

  it('stays lit on a nested child route', () => {
    expect(isNavItemActive('/admin/owners', '/admin/owners/abc')).toBe(true);
  });
});
