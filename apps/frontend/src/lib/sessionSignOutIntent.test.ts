import { describe, expect, it } from 'vitest';
import { SIGN_OUT_GRACE_MS, isWithinSignOutGrace } from './sessionSignOutIntent';

const T = 1_000_000;

describe('suppressing the expiry notice around a deliberate sign-out', () => {
  // Signing out revokes the session, so requests already in flight return
  // 401 SESSION_REVOKED — identical to a real revocation. Without this the
  // user tapped Sign out and was told "Session expired for your security".
  it('suppresses a notice arriving immediately after sign-out', () => {
    expect(isWithinSignOutGrace(T, T)).toBe(true);
    expect(isWithinSignOutGrace(T, T + 1_000)).toBe(true);
  });

  it('stops suppressing once the grace window passes', () => {
    expect(isWithinSignOutGrace(T, T + SIGN_OUT_GRACE_MS)).toBe(false);
    expect(isWithinSignOutGrace(T, T + SIGN_OUT_GRACE_MS + 1)).toBe(false);
  });

  // The whole reason this is a timestamp and not a boolean: nobody has to
  // remember to clear it, so a genuine expiry can never be silenced forever by
  // a logout that failed halfway through.
  it('never suppresses when no sign-out has been marked', () => {
    expect(isWithinSignOutGrace(0, T)).toBe(false);
  });

  it('does not open an unbounded window if the clock jumps backwards', () => {
    expect(isWithinSignOutGrace(T, T - 60_000)).toBe(false);
  });
});
