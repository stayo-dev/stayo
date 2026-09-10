import { describe, expect, it } from 'vitest';
import { accessModeLabel, acceptanceBadge, isAwaitingAcceptance } from './accessMode';

describe('accessModeLabel', () => {
  it('marks an owner-managed tenant as not on the app', () => {
    expect(accessModeLabel('OWNER_MANAGED')).toBe('Not on app');
  });

  it('shows nothing for a normal tenant — the common case needs no badge', () => {
    expect(accessModeLabel('SELF_SERVE')).toBeNull();
    expect(accessModeLabel(undefined)).toBeNull();
  });
});

describe('acceptanceBadge', () => {
  it('a new-model tenant who has not accepted reads "Awaiting acceptance"', () => {
    expect(acceptanceBadge({ acceptanceStatus: 'PENDING', accessMode: 'OWNER_MANAGED' })).toBe(
      'Awaiting acceptance',
    );
  });

  it('a grandfathered owner-managed tenant reads "Not on app"', () => {
    expect(acceptanceBadge({ acceptanceStatus: 'NOT_REQUIRED', accessMode: 'OWNER_MANAGED' })).toBe(
      'Not on app',
    );
    expect(acceptanceBadge({ accessMode: 'OWNER_MANAGED' })).toBe('Not on app');
  });

  it('an accepted / self-serve tenant has no badge', () => {
    expect(acceptanceBadge({ acceptanceStatus: 'ACCEPTED', accessMode: 'SELF_SERVE' })).toBeNull();
    expect(acceptanceBadge({ accessMode: 'SELF_SERVE' })).toBeNull();
    expect(acceptanceBadge({})).toBeNull();
  });
});

describe('isAwaitingAcceptance', () => {
  it('is true only for PENDING', () => {
    expect(isAwaitingAcceptance({ acceptanceStatus: 'PENDING' })).toBe(true);
    expect(isAwaitingAcceptance({ acceptanceStatus: 'ACCEPTED' })).toBe(false);
    expect(isAwaitingAcceptance({ acceptanceStatus: 'NOT_REQUIRED' })).toBe(false);
    expect(isAwaitingAcceptance({})).toBe(false);
  });
});
