/**
 * Reading the Clerk session from outside React (ADR-176 Phase 3).
 *
 * `api-client.ts` and `AuthContext` both need to know whether a Clerk session
 * exists, and neither can use Clerk's hooks: the API client is a plain module,
 * and `AuthProvider` is mounted *above* `ClerkAuthProvider` on every shell.
 * Inverting that nesting would have forced Clerk onto the public landing page,
 * undoing Phase 2.6.
 *
 * Clerk's own SDK publishes `window.Clerk` once it loads, with `addListener`
 * for changes — so the bridge is the global, not the React tree. When Clerk was
 * never mounted (the public shell, or no publishable key at all) the global is
 * simply absent and every function here degrades to "no Clerk session", which
 * is exactly the pre-Clerk behaviour.
 *
 * The decision logic is split out as `pickSessionSource` so it can be tested
 * without a browser.
 */

export type SessionSource = "supabase" | "clerk" | "none";

/**
 * Which provider speaks for this browser.
 *
 * **Clerk wins whenever it has a session** (ADR-204 — Clerk is the only
 * authentication provider). A Supabase session answers only for a browser
 * that has no Clerk session: someone signed in before the cutover whose
 * account has not moved yet. The ordering used to be the reverse, to protect
 * those sessions while Clerk was additive; now it would do the opposite harm —
 * a stale Supabase session left in storage would shadow a fresh Clerk
 * sign-in, and the backend refuses that stale token for a moved account.
 */
export function pickSessionSource(input: {
  hasSupabaseSession: boolean;
  hasClerkSession: boolean;
}): SessionSource {
  if (input.hasClerkSession) return "clerk";
  if (input.hasSupabaseSession) return "supabase";
  return "none";
}

/** The bits of `window.Clerk` this app touches. */
interface ClerkGlobal {
  session?: { getToken: () => Promise<string | null> } | null;
  addListener?: (cb: (resources: { session?: unknown | null }) => void) => () => void;
}

function clerkGlobal(): ClerkGlobal | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Clerk?: ClerkGlobal }).Clerk ?? null;
}

/** True when Clerk is loaded *and* holds a session. Never throws. */
export function hasClerkSession(): boolean {
  return Boolean(clerkGlobal()?.session);
}

/**
 * A Clerk session JWT for `Authorization: Bearer`, or null.
 *
 * Returns null rather than throwing on every failure path — an unavailable
 * Clerk must degrade to an unauthenticated request, not break the API client
 * for Supabase users.
 */
export async function getClerkToken(): Promise<string | null> {
  try {
    const session = clerkGlobal()?.session;
    if (!session) return null;
    return (await session.getToken()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Call `onChange` whenever Clerk's session appears or disappears.
 *
 * Returns an unsubscribe function; a no-op when Clerk is not present, so
 * callers need no branch of their own.
 */
export function subscribeToClerkSession(onChange: () => void): () => void {
  const clerk = clerkGlobal();
  if (!clerk?.addListener) return () => {};
  try {
    return clerk.addListener(() => onChange());
  } catch {
    return () => {};
  }
}

/**
 * End the Clerk session, if there is one.
 *
 * Used when the backend refuses a sign-in (no Stayo account, disabled login).
 * Leaving a live Clerk session behind for someone the product will not admit
 * means every later navigation re-attempts and re-fails; signing out makes the
 * rejection final and the next attempt clean. Never throws.
 */
export async function signOutClerk(): Promise<void> {
  try {
    const clerk = clerkGlobal() as (ClerkGlobal & { signOut?: () => Promise<void> }) | null;
    await clerk?.signOut?.();
  } catch {
    /* already gone, or Clerk never loaded */
  }
}
