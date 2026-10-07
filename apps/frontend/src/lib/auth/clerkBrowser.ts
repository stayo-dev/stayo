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

/**
 * Whether `AuthContext` must hold off deciding "signed out" because Clerk has
 * not finished loading yet.
 *
 * Clerk's SDK loads asynchronously, and `AuthProvider` resolves its session
 * before `ClerkProvider` (mounted below it) has published `window.Clerk`. On a
 * cold load of the owner app — every full-page handoff from the homepage
 * sign-in, every refresh — that first check saw no session, finished loading
 * as signed-out, and `ProtectedRoute` bounced a perfectly signed-in owner to
 * `/login` before Clerk ever reported the session.
 *
 * Only shells that actually mount Clerk set `awaitClerk`; elsewhere nothing is
 * coming and waiting would hang the page.
 */
export function shouldAwaitClerk(input: {
  source: SessionSource;
  awaitClerk: boolean;
  clerkLoaded: boolean;
}): boolean {
  return input.source === "none" && input.awaitClerk && !input.clerkLoaded;
}

/** The bits of `window.Clerk` this app touches. */
interface ClerkGlobal {
  loaded?: boolean;
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

/** True once Clerk's SDK has finished loading in this tab. Never throws. */
export function isClerkLoaded(): boolean {
  return clerkGlobal()?.loaded === true;
}

/**
 * Dispatched on `window` by `ClerkRuntime` whenever Clerk's loaded/signed-in
 * state changes. `window.Clerk.addListener` only exists once the SDK has
 * loaded, so a subscriber that arrived first — `AuthProvider`, always — would
 * otherwise never hear about it.
 */
export const CLERK_SESSION_EVENT = "stayo:clerk-session";

export function announceClerkSession(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CLERK_SESSION_EVENT));
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
 * Returns an unsubscribe function. Safe to call before Clerk has loaded, or
 * when it is never mounted at all — callers need no branch of their own.
 */
export function subscribeToClerkSession(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  // Covers Clerk loading *after* this call, which `addListener` cannot.
  const handler = () => onChange();
  window.addEventListener(CLERK_SESSION_EVENT, handler);

  let unsubscribeClerk: () => void = () => {};
  const clerk = clerkGlobal();
  if (clerk?.addListener) {
    try {
      unsubscribeClerk = clerk.addListener(() => onChange());
    } catch {
      /* fall back to the window event alone */
    }
  }

  return () => {
    window.removeEventListener(CLERK_SESSION_EVENT, handler);
    unsubscribeClerk();
  };
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
