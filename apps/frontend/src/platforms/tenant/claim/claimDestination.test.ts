import { describe, it, expect } from 'vitest';
import { claimDestination } from './claimDestination';

describe('claimDestination', () => {
  it('sends a claimed tenant who still owes onboarding into it', () => {
    expect(claimDestination({ activationRequired: true, signedIn: true })).toBe('/activate');
  });

  it('sends a tenant who has already onboarded straight home', () => {
    // Someone claiming a second tenancy, or re-running a claim they finished.
    expect(claimDestination({ activationRequired: false, signedIn: true })).toBe('/tenant/home');
  });

  it('goes to login when no session was minted, whatever is still owed', () => {
    // /activate resolves a claimed tenant by their session; without one there
    // is nothing for it to resolve, so onboarding has to wait for a login.
    expect(claimDestination({ activationRequired: true, signedIn: false })).toBe('/login?signin=1');
    expect(claimDestination({ activationRequired: false, signedIn: false })).toBe('/login?signin=1');
  });

  it('treats a missing flag as nothing owed rather than looping a finished tenant', () => {
    // An older backend that does not send `activation_required` should not
    // push every claimant into onboarding they may already have completed.
    expect(claimDestination({ signedIn: true })).toBe('/tenant/home');
    expect(claimDestination({ activationRequired: null, signedIn: true })).toBe('/tenant/home');
  });
});
