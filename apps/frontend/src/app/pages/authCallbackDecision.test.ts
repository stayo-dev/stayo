import { describe, it, expect } from 'vitest';
import { shouldProvisionAccount } from './authCallbackDecision';

const base = { status: 403, code: 'NO_STAYO_ACCOUNT', provisionAllowed: true };

describe('shouldProvisionAccount', () => {
  it('creates an account when a tenant signs in with an unknown Google email', () => {
    expect(shouldProvisionAccount(base)).toBe(true);
  });

  /**
   * The bug this guards: the intent flag was destroyed by an earlier pass of
   * the callback effect, so the pass handling the 403 saw false and rendered
   * "No account found" instead of signing the person up.
   */
  it('does not create one when the surface did not allow it', () => {
    expect(shouldProvisionAccount({ ...base, provisionAllowed: false })).toBe(false);
  });

  it('never creates one on a 401 — that is a deployment problem, not a new user', () => {
    expect(shouldProvisionAccount({ ...base, status: 401 })).toBe(false);
  });

  it('never creates one for a different 403 reason', () => {
    for (const code of ['ACCOUNT_DISABLED', 'TENANCY_NOT_ACTIVATED', undefined]) {
      expect(shouldProvisionAccount({ ...base, code })).toBe(false);
    }
  });

  it('never creates one when the request simply failed', () => {
    expect(shouldProvisionAccount({ ...base, status: undefined })).toBe(false);
  });
});
