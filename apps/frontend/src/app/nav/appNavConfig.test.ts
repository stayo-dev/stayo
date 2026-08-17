import { describe, it, expect } from 'vitest';
import { buildOuterTabs } from './appNavConfig';

describe('buildOuterTabs', () => {
  it('calls the account tab "Log in" for a visitor who has no account yet', () => {
    // A first-time seeker landing on Discovery has no profile — offering them
    // "Profile" advertises something that does not exist.
    const tabs = buildOuterTabs({ signedIn: false, liveTenancy: false });
    expect(tabs.find((t) => t.to === '/profile')?.label).toBe('Log in');
  });

  it('calls it "Profile" once they have an account', () => {
    const tabs = buildOuterTabs({ signedIn: true, liveTenancy: false });
    expect(tabs.find((t) => t.to === '/profile')?.label).toBe('Profile');
  });

  it('keeps Explore alongside it either way', () => {
    for (const signedIn of [true, false]) {
      const tabs = buildOuterTabs({ signedIn, liveTenancy: false });
      expect(tabs.map((t) => t.to)).toEqual(['/discover', '/profile']);
    }
  });

  it('uses the full tenant bar once there is a live tenancy', () => {
    const tabs = buildOuterTabs({ signedIn: true, liveTenancy: true });
    expect(tabs).toHaveLength(6);
    expect(tabs.find((t) => t.to === '/profile')?.label).toBe('Profile');
  });

  it('never shows "Log in" to someone with a live tenancy — they are signed in by definition', () => {
    const tabs = buildOuterTabs({ signedIn: false, liveTenancy: true });
    expect(tabs.find((t) => t.to === '/profile')?.label).toBe('Profile');
  });

  it('routes the account tab to /profile in both states, so the destination never moves', () => {
    expect(buildOuterTabs({ signedIn: false, liveTenancy: false }).find((t) => t.label === 'Log in')?.to)
      .toBe('/profile');
  });
});
