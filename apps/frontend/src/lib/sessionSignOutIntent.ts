/**
 * Whether the session ending right now is something the user asked for.
 *
 * Signing out **revokes** the session server-side (a Redis deny-list, ADR-031),
 * so every request still in flight when the user taps Sign out comes back
 * `401 SESSION_REVOKED` — byte-identical to a session revoked *underneath* them.
 * The 401 interceptor could not tell the two apart, so a deliberate logout
 * raised "Session expired for your security", which is both untrue and alarming:
 * nothing expired, and nothing about their security needed protecting.
 *
 * ## Why a time window rather than a flag
 *
 * A plain boolean has to be cleared by someone, and if anything skips the clear
 * — an error mid-logout, a navigation that unmounts first — genuine expiries go
 * silent from then on. That fails **open**, in the security-notice direction,
 * which is the wrong way for this to break.
 *
 * A timestamp expires on its own. The worst case is that a real revocation
 * arriving within a few seconds of a deliberate sign-out is not announced — and
 * in that window the user is being signed out anyway, so the notice would have
 * told them nothing they were not already seeing.
 */

/** Long enough for requests in flight at sign-out; short enough to be harmless. */
export const SIGN_OUT_GRACE_MS = 10_000;

let signedOutAt = 0;

/** Call immediately before a deliberate sign-out begins. */
export function markIntentionalSignOut(now = Date.now()): void {
  signedOutAt = now;
}

/** Cleared on a successful sign-in, so a fresh session starts with no grace. */
export function clearIntentionalSignOut(): void {
  signedOutAt = 0;
}

/** Pure, so the rule is testable without touching module state. */
export function isWithinSignOutGrace(markedAt: number, now: number): boolean {
  if (!markedAt) return false;
  const elapsed = now - markedAt;
  // A clock that jumped backwards must not open an unbounded window.
  if (elapsed < 0) return false;
  return elapsed < SIGN_OUT_GRACE_MS;
}

/** Whether a session-expiry notice should be suppressed right now. */
export function shouldSuppressExpiryNotice(now = Date.now()): boolean {
  return isWithinSignOutGrace(signedOutAt, now);
}
