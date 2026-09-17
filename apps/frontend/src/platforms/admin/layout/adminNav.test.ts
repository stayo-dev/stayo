import { describe, it, expect } from 'vitest';
import { buildAdminNav, isNavItemActive } from './adminNav';

describe('buildAdminNav — ADMIN session (unrestricted)', () => {
  it('returns the four design groups in order', () => {
    const groups = buildAdminNav({}, 'admin');
    expect(groups.map((g) => g.label)).toEqual(['Manage', 'Review', 'Business', 'Support']);
  });

  it('keeps Settings in the Support group even though the design omits it', () => {
    const support = buildAdminNav({}, 'admin').find((g) => g.label === 'Support');
    expect(support?.items.map((i) => i.to)).toContain('/admin/settings');
  });

  it('omits a badge when the count is zero or missing', () => {
    const groups = buildAdminNav({ reviews: 0 }, 'admin');
    const reviews = groups.flatMap((g) => g.items).find((i) => i.to === '/admin/reviews');
    expect(reviews?.badge).toBe(0);
  });

  it('shows a badge when there is real work waiting', () => {
    expect(buildAdminNav({ reviews: 3 }, 'admin').flatMap((g) => g.items).find((i) => i.to === '/admin/reviews')?.badge)
      .toBe(3);
  });

  it('exposes every screen the console routes to, including the Manager-role console (ADR-214)', () => {
    // 'Hostel Listings' restored 2026-09-17 — ADR-170 (shelved for v1) was
    // superseded by ADR-192 (marketplace un-shelved), and the nav item just
    // hadn't caught up until now.
    // 'KYC Approvals' removed from the console entirely.
    const paths = buildAdminNav({}, 'admin').flatMap((g) => g.items).map((i) => i.to);
    expect(paths).toEqual([
      '/admin', '/admin/leads', '/admin/owners', '/admin/onboarding', '/admin/managers', '/admin/activity',
      '/admin/listings', '/admin/reviews',
      '/admin/revenue', '/admin/subscriptions',
      '/admin/reports', '/admin/broadcasts', '/admin/settings',
    ]);
  });
});

describe('buildAdminNav — MANAGER session (ADR-214, UX gating only)', () => {
  it('with no permissions, sees only Overview — every group with nothing to show is dropped entirely', () => {
    const groups = buildAdminNav({}, 'manager', []);
    expect(groups.map((g) => g.label)).toEqual(['Manage']);
    expect(groups[0].items.map((i) => i.to)).toEqual(['/admin']);
  });

  it('never sees Managers or Activity, even if somehow granted every permission string', () => {
    const paths = buildAdminNav({}, 'manager', [
      'MANAGE_LEADS', 'MANAGE_OWNERS', 'MANAGE_HOSTELS', 'MANAGE_ONBOARDING',
      'VIEW_REVENUE_ANALYTICS', 'MANAGE_SUBSCRIPTIONS', 'SUPPORT_REPORTS_BUGS',
      'MANAGE_BROADCASTS', 'MANAGE_SETTINGS',
    ]).flatMap((g) => g.items).map((i) => i.to);
    expect(paths).not.toContain('/admin/managers');
    expect(paths).not.toContain('/admin/activity');
  });

  it('sees exactly the item matching a single granted permission', () => {
    const groups = buildAdminNav({}, 'manager', ['MANAGE_OWNERS']);
    const manage = groups.find((g) => g.label === 'Manage');
    expect(manage?.items.map((i) => i.to)).toEqual(['/admin', '/admin/owners']);
    expect(groups.some((g) => g.label === 'Business')).toBe(false);
  });

  it('a role that is neither admin nor manager sees only the unrestricted item', () => {
    const groups = buildAdminNav({}, 'owner', ['MANAGE_OWNERS']);
    expect(groups.flatMap((g) => g.items).map((i) => i.to)).toEqual(['/admin']);
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
