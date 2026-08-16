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
    const groups = buildAdminNav({ kyc: 0 });
    const kyc = groups.flatMap((g) => g.items).find((i) => i.to === '/admin/kyc');
    expect(kyc?.badge).toBe(0);
  });

  it('shows a badge when there is real work waiting', () => {
    const groups = buildAdminNav({ kyc: 4, listings: 2 });
    const items = groups.flatMap((g) => g.items);
    expect(items.find((i) => i.to === '/admin/kyc')?.badge).toBe(4);
    expect(items.find((i) => i.to === '/admin/listings')?.badge).toBe(2);
  });

  it('exposes every screen the console routes to', () => {
    const paths = buildAdminNav({}).flatMap((g) => g.items).map((i) => i.to);
    expect(paths).toEqual([
      '/admin', '/admin/leads', '/admin/owners',
      '/admin/kyc', '/admin/listings',
      '/admin/revenue', '/admin/settlements', '/admin/subscriptions',
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
    expect(isNavItemActive('/admin/listings', '/admin/listings/abc')).toBe(true);
  });
});
