import { describe, it, expect } from 'vitest';
import {
  buildOuterTabs,
  canOpenDashboard,
  hasFarewell,
  isDashboardReadOnly,
  ACTIVE_TENANT_TABS,
  EXPLORE_PROFILE_TABS,
} from './appNavConfig';
import { hasLiveTenancy, tenancyState } from './useAppNav';

/**
 * The three-state tenancy, and why it isn't two (ADR-122).
 *
 * `vacate` flips a tenant to FORMER_TENANT when the bed is released;
 * `complete` settles the money a step later. Gating access on the status
 * alone locked people out of the app between those two moments — while a
 * refund was still owed to them.
 */

describe('tenancyState', () => {
  it('trusts the value the backend computed', () => {
    expect(tenancyState({ tenancy_state: 'EXITING', tenant_status: 'FORMER_TENANT' })).toBe('EXITING');
  });

  it('falls back to the status for a session hydrated before the field shipped', () => {
    expect(tenancyState({ tenant_status: 'ACTIVE' })).toBe('LIVE');
    expect(tenancyState({ tenant_status: 'INVITED' })).toBe('LIVE');
    expect(tenancyState({ tenant_status: 'FORMER_TENANT' })).toBe('EXITED');
  });

  it('treats an account with no tenancy as NONE, not as someone who left', () => {
    // A Discover-only marketplace account never had a tenancy; sending it to
    // a farewell screen would be nonsense.
    expect(tenancyState({ tenant_status: null })).toBe('NONE');
    expect(tenancyState(null)).toBe('NONE');
  });

  it('ignores a junk value from the wire rather than trusting it', () => {
    expect(tenancyState({ tenancy_state: 'WHATEVER', tenant_status: 'ACTIVE' })).toBe('LIVE');
  });
});

describe('dashboard access', () => {
  it('keeps the dashboard open while the settlement is unfinished', () => {
    // The whole point: they are owed money and must be able to watch it land.
    expect(canOpenDashboard('EXITING')).toBe(true);
    expect(isDashboardReadOnly('EXITING')).toBe(true);
  });

  it('gives a live tenant the full dashboard, not a read-only one', () => {
    expect(canOpenDashboard('LIVE')).toBe(true);
    expect(isDashboardReadOnly('LIVE')).toBe(false);
  });

  it('closes the dashboard once everything is settled', () => {
    expect(canOpenDashboard('EXITED')).toBe(false);
  });

  it('never opens the dashboard for an account with no tenancy', () => {
    expect(canOpenDashboard('NONE')).toBe(false);
    expect(canOpenDashboard(null)).toBe(false);
  });
});

describe('hasFarewell', () => {
  it('is true for anyone with a tenancy behind them', () => {
    expect(hasFarewell('EXITING')).toBe(true);
    expect(hasFarewell('EXITED')).toBe(true);
  });

  it('is false for a live tenant and for a browse-only account', () => {
    // This is what keeps ProtectedTenantRoute from redirecting a
    // never-was-a-tenant account to a farewell screen.
    expect(hasFarewell('LIVE')).toBe(false);
    expect(hasFarewell('NONE')).toBe(false);
  });
});

describe('buildOuterTabs', () => {
  it('keeps the dashboard tabs for a tenant mid-exit', () => {
    // The bar used to change shape the moment the bed was released, so Home,
    // Room, Food and Payments simply vanished from under them.
    expect(buildOuterTabs({ signedIn: true, liveTenancy: false, tenancyState: 'EXITING' }))
      .toEqual(ACTIVE_TENANT_TABS);
  });

  it('drops to Explore/Profile once the exit is settled', () => {
    expect(buildOuterTabs({ signedIn: true, liveTenancy: false, tenancyState: 'EXITED' }))
      .toEqual(EXPLORE_PROFILE_TABS);
  });

  it('still gives a live tenant the full bar', () => {
    expect(buildOuterTabs({ signedIn: true, liveTenancy: true, tenancyState: 'LIVE' }))
      .toEqual(ACTIVE_TENANT_TABS);
  });

  it('offers Log in to a signed-out visitor, unchanged', () => {
    const tabs = buildOuterTabs({ signedIn: false, liveTenancy: false });
    expect(tabs.find((t) => t.action === 'SIGN_IN')?.label).toBe('Log in');
  });

  it('behaves as before when no tenancy state is supplied', () => {
    // Callers that predate the third state must not change behaviour.
    expect(buildOuterTabs({ signedIn: true, liveTenancy: false })).toEqual(EXPLORE_PROFILE_TABS);
    expect(buildOuterTabs({ signedIn: true, liveTenancy: true })).toEqual(ACTIVE_TENANT_TABS);
  });
});

describe('hasLiveTenancy — unchanged meaning', () => {
  it('still means INVITED or ACTIVE only', () => {
    expect(hasLiveTenancy({ tenant_status: 'ACTIVE' })).toBe(true);
    expect(hasLiveTenancy({ tenant_status: 'FORMER_TENANT' })).toBe(false);
    expect(hasLiveTenancy(null)).toBe(false);
  });
});
