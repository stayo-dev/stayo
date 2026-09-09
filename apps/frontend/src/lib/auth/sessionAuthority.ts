/**
 * Who is allowed onto a protected route, while two auth providers coexist
 * (ADR-176, Phase 2).
 *
 * The rule this module exists to hold: **a Clerk session, on its own, authorises
 * nothing.** Business roles (`OWNER`, `TENANT`, `ADMIN`, `WARDEN`) live in our
 * database and reach the browser only through `AuthContext`, which is still
 * backed by Supabase. Until the backend accepts Clerk tokens and returns a
 * profile for them (Phase 3), somebody signed into Clerk is *identified* but not
 * *authorised* — and treating those as the same thing would let a brand-new
 * Clerk signup walk into an owner dashboard.
 *
 * `clerk` is therefore accepted and deliberately ignored by `decideRouteAccess`.
 * That is not dead weight: it is the seam Phase 3 changes, and
 * `sessionAuthority.test.ts` asserts across a full matrix that varying the Clerk
 * state never changes a single decision. If that test ever fails, authorisation
 * has started depending on the provider we have not finished migrating to.
 *
 * PURE — plain arguments, no React, no I/O.
 */

/** The profile-backed session. Today: Supabase. Phase 3: either provider. */
export interface ProfileSession {
  role: string;
}

/**
 * What `@clerk/clerk-react`'s `useAuth()` tells us, narrowed. `null` means Clerk
 * is not configured at all (no publishable key), which is a supported state.
 */
export interface ClerkSessionState {
  isLoaded: boolean;
  isSignedIn: boolean;
}

export type RouteDecision = "loading" | "allow" | "redirect-login" | "redirect-home";

export interface RouteAccessInput {
  /** `AuthContext`'s `loading` — the profile session is still being resolved. */
  profileLoading: boolean;
  profile: ProfileSession | null;
  /** Present but unused for the decision in Phase 2. See the module header. */
  clerk: ClerkSessionState | null;
  allowedRoles?: readonly string[];
}

/**
 * Reproduces exactly the behaviour `ProtectedRoute` had before Clerk existed:
 * wait while loading, send a session-less visitor to `/login`, send a
 * wrong-role visitor to `/`, otherwise allow.
 */
export function decideRouteAccess(input: RouteAccessInput): RouteDecision {
  const { profileLoading, profile, allowedRoles } = input;

  if (profileLoading) return "loading";

  // No profile means no role, and no role means no authority — regardless of
  // whether Clerk considers this browser signed in.
  if (!profile) return "redirect-login";

  if (allowedRoles && !allowedRoles.includes(profile.role)) return "redirect-home";

  return "allow";
}

/**
 * Display-only view of the Clerk session, for surfaces that should appear when
 * Clerk is live and stay invisible otherwise — the `UserButton`, chiefly.
 *
 * Never feed this into an authorisation decision; that is what
 * `decideRouteAccess` is for.
 */
export type ClerkPresence = "not-configured" | "loading" | "signed-in" | "signed-out";

export function clerkPresence(clerk: ClerkSessionState | null): ClerkPresence {
  if (!clerk) return "not-configured";
  if (!clerk.isLoaded) return "loading";
  return clerk.isSignedIn ? "signed-in" : "signed-out";
}

/**
 * Whether to tell someone their Clerk sign-in has not been joined to a Stayo
 * account yet.
 *
 * This is the visible edge of the Phase 2/3 boundary: they completed a Clerk
 * sign-in, and the product still does not know who they are, because nothing
 * reads `users.clerk_user_id` on a request path yet. Saying so is better than a
 * silent bounce back to `/login`, which reads as "your sign-in failed".
 */
export function shouldExplainUnlinkedClerkSession(input: {
  profileLoading: boolean;
  profile: ProfileSession | null;
  clerk: ClerkSessionState | null;
}): boolean {
  if (input.profileLoading) return false;
  if (input.profile) return false;
  return clerkPresence(input.clerk) === "signed-in";
}
