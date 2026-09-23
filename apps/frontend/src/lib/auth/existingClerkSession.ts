/**
 * What to do when a sign-in ticket arrives at a browser that already holds a
 * Clerk session (ADR-204).
 *
 * How that state is reachable: on the public shell `AuthContext` decides
 * "signed out" without loading Clerk (ADR-176 Phase 2.6 keeps the SDK off `/`),
 * yet Clerk's session lives in cookies and survives. So a returning person sees
 * the login modal, signs in, and only then does Clerk load — and find the old
 * session. Redeeming a ticket on top of it is rejected with `session_exists`.
 *
 * The obvious answer — "you are already signed in, carry on" — is only right
 * when the session belongs to the person who just proved their password.
 * Adopting someone else's would leave the UI showing the account just typed
 * while every API call carried the other account's token. Identity is
 * therefore compared, and anything that cannot be shown to be the same person
 * is replaced rather than adopted.
 *
 * PURE — no React, no I/O. The effects live in `clerkTicket.ts`.
 */

export type ExistingSessionAction =
  /** No session in this browser: redeem the ticket as usual. */
  | "redeem"
  /** The session already belongs to the person signing in: use it, skip the ticket. */
  | "reuse"
  /** The session belongs to someone else, or we cannot tell: end it, then redeem. */
  | "replace";

function id(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function decideExistingSession(input: {
  hasActiveSession: boolean;
  /** `Clerk.user.externalId` — our profile id, set by the backend when it creates the Clerk user. */
  sessionExternalId: unknown;
  /** `user_id` from the sign-in response — the profile that just proved its password. */
  expectedProfileId: unknown;
}): ExistingSessionAction {
  if (!input.hasActiveSession) return "redeem";

  const session = id(input.sessionExternalId);
  const expected = id(input.expectedProfileId);
  // Both must be known and equal. A missing id on either side is "cannot
  // tell", which is never grounds for adopting a session.
  if (session && expected && session === expected) return "reuse";

  return "replace";
}

/** The profile a sign-in response is for. Empty when the response does not say. */
export function readHandoffProfileId(responseData: unknown): string {
  const body = (responseData ?? {}) as Record<string, unknown>;
  return id(body.user_id);
}

/**
 * Same root cause as `decideExistingSession`, for Google rather than a
 * password ticket: Clerk refuses `signIn.create`/`authenticateWithRedirect`
 * outright whenever this browser already holds a session (`session_exists`),
 * and the public shell reaching the login modal without having loaded Clerk
 * means a leftover session is common here too.
 *
 * There is no `expectedProfileId` to compare against — that is the point of
 * redirecting to Google in the first place, the identity isn't known yet — so
 * "reuse" is not an option; an existing session is always ended first. Once
 * Google's own account chooser and consent step decide who this is,
 * `redeemSignInTicket`'s identity check (or the backend's own linking rule)
 * governs everything downstream of that.
 */
export function shouldSignOutBeforeGoogle(hasActiveSession: boolean): boolean {
  return hasActiveSession;
}
