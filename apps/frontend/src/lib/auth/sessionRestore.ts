/**
 * Restoring a signed-in session on page load (ADR-204).
 *
 * Since ADR-204 a password sign-in leaves only a Clerk session behind, and
 * Clerk's SDK loads asynchronously. `AuthContext` used to decide "signed out"
 * the moment Supabase reported no session — before Clerk had finished loading —
 * and attached its Clerk listener while `window.Clerk` did not exist yet, so it
 * never heard the session arrive. Every full page load of a protected route
 * (homepage hand-off, refresh, new tab) therefore bounced a signed-in person to
 * `/login`. The tenant shell mounts no `ClerkProvider` at all, so there Clerk
 * never loaded and a reload *always* signed the tenant out.
 *
 * The rule now: **while Clerk may still produce a session, nobody is signed
 * out.** The same rule `/auth/callback` already follows (`decideCallbackAction`).
 *
 * Restoring a session decides only *whether to ask the backend who this is*.
 * Roles and permissions still come from `GET /auth/me`; a Clerk session never
 * stands in for a profile (see `sessionAuthority.ts`).
 *
 * No React and no `window` here — every effect arrives as a dependency, so
 * the whole lifecycle runs under the node-only test suite.
 */
import { pickSessionSource } from './clerkBrowser';

/**
 * How a shell gets Clerk loaded so a session can be restored.
 *
 * - `provider` — the shell mounts `ClerkProvider` (owner, admin), which owns
 *   the load; restore waits for it rather than loading a second time.
 * - `load` — no provider, but signed-in content lives here (`/tenant`,
 *   `/payment-return`, `/stay`, `/onboarding`): load Clerk directly.
 * - `load-if-signed-in` — public pages. Load Clerk only when Clerk's own
 *   signed-in cookie says there is something to restore, so an anonymous
 *   visitor to `/` still never downloads the SDK (ADR-176 Phase 2.6).
 */
export type ClerkRestoreMode = 'provider' | 'load' | 'load-if-signed-in';

/**
 * Where Clerk stands for this restore.
 *
 * `not-configured` (no publishable key) and `skipped` (public page, nobody
 * signed in) are final: no Clerk session is coming. `failed` means loading
 * gave up or timed out — also treated as "no Clerk session", which fails
 * closed to signed-out rather than hanging.
 */
export type ClerkRestorePhase = 'not-configured' | 'skipped' | 'loading' | 'ready' | 'failed';

export type SessionDecision = 'wait' | 'hydrate' | 'signed-out';

/**
 * Paths whose content needs a session, on shells that mount no ClerkProvider:
 * the tenant app, the tenant-guarded `/payment-return`, the hostel QR page
 * (`/stay/:hostelId` — always a fresh page load, and it must recognise a
 * returning resident), and the owner onboarding wizard.
 */
const SIGNED_IN_PREFIXES = ['/tenant', '/payment-return', '/stay', '/onboarding'];

export function clerkRestoreModeForPath(pathname: string): ClerkRestoreMode {
  return SIGNED_IN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
    ? 'load'
    : 'load-if-signed-in';
}

/**
 * Clerk's `__client_uat` cookie ("client updated at") is set on the app's own
 * domain: a positive timestamp while a client is signed in, `0` after sign-out.
 * Newer clerk-js versions also write a suffixed copy (`__client_uat_<id>`).
 * It is a hint for *whether to load Clerk*, never a credential.
 */
export function hasClerkSignedInHint(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some((part) => {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName !== '__client_uat' && !rawName.startsWith('__client_uat_')) return false;
    return Number(rest.join('=')) > 0;
  });
}

export function initialClerkPhase(input: {
  configured: boolean;
  mode: ClerkRestoreMode;
  alreadyLoaded: boolean;
  hasSignedInHint: boolean;
}): ClerkRestorePhase {
  if (!input.configured) return 'not-configured';
  if (input.alreadyLoaded) return 'ready';
  if (input.mode === 'load-if-signed-in' && !input.hasSignedInHint) return 'skipped';
  return 'loading';
}

/**
 * What to do with what is known right now.
 *
 * `supabaseKnown` is false until Supabase has reported its initial session.
 * A session from either provider means "ask the backend who this is" — Clerk
 * first when it has one, exactly as `pickSessionSource` orders them. With no
 * session yet, waiting is correct only while Clerk is still loading.
 */
export function decideSessionResolution(input: {
  supabaseKnown: boolean;
  hasSupabaseSession: boolean;
  clerkPhase: ClerkRestorePhase;
  hasClerkSession: boolean;
}): SessionDecision {
  if (!input.supabaseKnown) return 'wait';
  const source = pickSessionSource({
    hasSupabaseSession: input.hasSupabaseSession,
    hasClerkSession: input.clerkPhase === 'ready' && input.hasClerkSession,
  });
  if (source !== 'none') return 'hydrate';
  return input.clerkPhase === 'loading' ? 'wait' : 'signed-out';
}

/** Long enough for a slow mobile connection; short enough not to strand anyone. */
export const CLERK_RESTORE_TIMEOUT_MS = 10_000;

export interface SessionRestoreDeps<U> {
  clerkPhase: ClerkRestorePhase;
  /** Resolves when Clerk is loaded. Only called when `clerkPhase` is `loading`. */
  loadClerk: (signal: AbortSignal) => Promise<void>;
  hasClerkSession: () => boolean;
  /** Returns an unsubscribe. Attached only once Clerk is ready. */
  subscribeClerk: (onChange: () => void) => () => void;
  /** Must report the initial session once, then every change. Returns an unsubscribe. */
  subscribeSupabase: (onChange: (event: string, hasSession: boolean) => void) => () => void;
  getSupabaseSession: () => Promise<boolean>;
  /** `GET /auth/me`. The only source of role and permissions. */
  fetchProfile: () => Promise<U>;
  setUser: (user: U | null) => void;
  /** Ends the initial loading state. */
  settle: () => void;
  timeoutMs?: number;
}

export interface SessionRestoreHandle {
  /** Stop everything: listeners, timers, and any in-flight result. */
  dispose: () => void;
  /**
   * Something outside the restore set the user (sign-in, sign-out). Any
   * profile fetch already in flight is stale and must not overwrite it.
   */
  supersede: () => void;
}

export function startSessionRestore<U>(deps: SessionRestoreDeps<U>): SessionRestoreHandle {
  let disposed = false;
  let phase = deps.clerkPhase;
  let supabaseKnown = false;
  let hasSupabaseSession = false;
  let generation = 0;
  let unsubscribeClerk: (() => void) | null = null;
  const abort = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const evaluate = () => {
    if (disposed) return;
    const decision = decideSessionResolution({
      supabaseKnown,
      hasSupabaseSession,
      clerkPhase: phase,
      hasClerkSession: deps.hasClerkSession(),
    });
    if (decision === 'wait') return;

    const current = ++generation;
    if (decision === 'signed-out') {
      deps.setUser(null);
      deps.settle();
      return;
    }
    deps.fetchProfile().then(
      (user) => {
        if (disposed || current !== generation) return;
        deps.setUser(user);
        deps.settle();
      },
      () => {
        if (disposed || current !== generation) return;
        deps.setUser(null);
        deps.settle();
      },
    );
  };

  const attachClerk = () => {
    if (disposed || unsubscribeClerk) return;
    unsubscribeClerk = deps.subscribeClerk(() => {
      if (disposed) return;
      deps.getSupabaseSession().then(
        (has) => {
          hasSupabaseSession = has;
          evaluate();
        },
        () => evaluate(),
      );
    });
  };

  const unsubscribeSupabase = deps.subscribeSupabase((event, hasSession) => {
    supabaseKnown = true;
    hasSupabaseSession = event === 'SIGNED_OUT' ? false : hasSession;
    evaluate();
  });

  if (phase === 'ready') attachClerk();

  if (phase === 'loading') {
    timeout = setTimeout(() => {
      if (disposed || phase !== 'loading') return;
      phase = 'failed';
      evaluate();
    }, deps.timeoutMs ?? CLERK_RESTORE_TIMEOUT_MS);

    deps.loadClerk(abort.signal).then(
      () => {
        if (disposed) return;
        clearTimeout(timeout);
        // A load that lands after the timeout still counts: someone who was
        // shown signed-out on a slow connection is picked up when it arrives.
        phase = 'ready';
        attachClerk();
        evaluate();
      },
      () => {
        if (disposed) return;
        clearTimeout(timeout);
        if (phase !== 'loading') return;
        phase = 'failed';
        evaluate();
      },
    );
  }

  return {
    dispose: () => {
      disposed = true;
      clearTimeout(timeout);
      abort.abort();
      unsubscribeSupabase();
      unsubscribeClerk?.();
      unsubscribeClerk = null;
    },
    supersede: () => {
      generation++;
    },
  };
}

/**
 * Where a signed-in visitor on `/login` belongs. `/login` exists for people
 * who need to sign in; anyone who already has a session is sent on.
 *
 * A tenant who has *just* signed in on `/login` is left alone: the login page
 * announces the cross-surface hand-off itself (`crossSurfaceLogin.ts`), and
 * jumping first would skip that explanation.
 */
export function signedInLoginRedirect(input: {
  role: string | null | undefined;
  tenantId?: string | null;
  justSignedIn: boolean;
}): string | null {
  const role = String(input.role ?? '').toLowerCase();
  if (role === 'admin' || role === 'manager') return '/admin';
  if (role === 'owner') return '/owner/home';
  if (role === 'tenant' && !input.justSignedIn) {
    return input.tenantId ? '/tenant/home' : '/discover';
  }
  return null;
}
