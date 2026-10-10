/**
 * The double-login regression (2026-10-09).
 *
 * After ADR-204 a password sign-in leaves only a Clerk session, and Clerk loads
 * asynchronously. `AuthContext` declared "signed out" as soon as Supabase
 * reported nothing — before Clerk had loaded — so every full page load of a
 * protected route sent a signed-in owner, admin, manager or tenant to `/login`.
 * These tests run the real restore lifecycle against fakes; the order things
 * happen in is the order they happen in a browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLERK_RESTORE_TIMEOUT_MS,
  clerkRestoreModeForPath,
  decideSessionResolution,
  hasClerkSignedInHint,
  initialClerkPhase,
  maySessionExist,
  readSessionHint,
  SESSION_HINT_KEY,
  signedInEntryRedirect,
  signedInLoginRedirect,
  startSessionRestore,
  writeSessionHint,
  type ClerkRestorePhase,
} from './sessionRestore';

describe('decideSessionResolution', () => {
  const base = { supabaseKnown: true, hasSupabaseSession: false, hasClerkSession: false };

  it('waits until Supabase has reported its initial session', () => {
    expect(decideSessionResolution({ ...base, supabaseKnown: false, clerkPhase: 'ready', hasClerkSession: true })).toBe('wait');
  });

  it('waits while Clerk is still loading and nothing else has a session — the bug', () => {
    expect(decideSessionResolution({ ...base, clerkPhase: 'loading' })).toBe('wait');
  });

  it('hydrates once Clerk is ready with a session', () => {
    expect(decideSessionResolution({ ...base, clerkPhase: 'ready', hasClerkSession: true })).toBe('hydrate');
  });

  it('ignores a Clerk session reported before Clerk is ready', () => {
    expect(decideSessionResolution({ ...base, clerkPhase: 'loading', hasClerkSession: true })).toBe('wait');
  });

  it('hydrates a pre-Clerk Supabase session without waiting for Clerk', () => {
    expect(decideSessionResolution({ ...base, hasSupabaseSession: true, clerkPhase: 'loading' })).toBe('hydrate');
  });

  it.each<ClerkRestorePhase>(['ready', 'not-configured', 'skipped', 'failed'])(
    'is signed out with no session once Clerk is %s — never waits after Clerk settles',
    (clerkPhase) => {
      expect(decideSessionResolution({ ...base, clerkPhase })).toBe('signed-out');
    },
  );
});

describe('initialClerkPhase', () => {
  const base = { configured: true, alreadyLoaded: false, hasSignedInHint: false };

  it('is not-configured without a publishable key, whatever the mode', () => {
    for (const mode of ['provider', 'load', 'load-if-signed-in'] as const) {
      expect(initialClerkPhase({ ...base, configured: false, mode, alreadyLoaded: true })).toBe('not-configured');
    }
  });

  it('is ready when Clerk is already loaded in this page (in-app navigation)', () => {
    expect(initialClerkPhase({ ...base, mode: 'load-if-signed-in', alreadyLoaded: true })).toBe('ready');
  });

  it('owner/admin shells and signed-in areas always wait for Clerk', () => {
    expect(initialClerkPhase({ ...base, mode: 'provider' })).toBe('loading');
    expect(initialClerkPhase({ ...base, mode: 'load' })).toBe('loading');
  });

  it('public pages load Clerk only for a signed-in browser — the homepage stays light', () => {
    expect(initialClerkPhase({ ...base, mode: 'load-if-signed-in' })).toBe('skipped');
    expect(initialClerkPhase({ ...base, mode: 'load-if-signed-in', hasSignedInHint: true })).toBe('loading');
  });
});

describe('clerkRestoreModeForPath', () => {
  it.each(['/tenant', '/tenant/home', '/tenant/payments', '/payment-return', '/stay/h-1', '/onboarding', '/onboarding/step-2'])('%s loads Clerk', (p) => {
    expect(clerkRestoreModeForPath(p)).toBe('load');
  });

  it.each(['/', '/login', '/owners', '/discover', '/discover/hostel/x', '/tenantx', '/stayo', '/get-started/submitted'])(
    '%s loads Clerk only when signed in',
    (p) => {
      expect(clerkRestoreModeForPath(p)).toBe('load-if-signed-in');
    },
  );
});

describe('hasClerkSignedInHint', () => {
  it('reads a positive __client_uat as signed in', () => {
    expect(hasClerkSignedInHint('a=1; __client_uat=1728460000; b=2')).toBe(true);
  });

  it('accepts the suffixed copy newer clerk-js writes', () => {
    expect(hasClerkSignedInHint('__client_uat_AbC123=1728460000')).toBe(true);
  });

  it('treats 0 (signed out), garbage, absence and lookalikes as not signed in', () => {
    expect(hasClerkSignedInHint('__client_uat=0')).toBe(false);
    expect(hasClerkSignedInHint('__client_uat=abc')).toBe(false);
    expect(hasClerkSignedInHint('')).toBe(false);
    expect(hasClerkSignedInHint(undefined)).toBe(false);
    expect(hasClerkSignedInHint('x__client_uat=99')).toBe(false);
  });
});

// ── The lifecycle ───────────────────────────────────────────────────────────

type User = { role: string };

function harness(opts: {
  clerkPhase: ClerkRestorePhase;
  profile?: User | (() => Promise<User>);
}) {
  let supabaseListener: ((event: string, has: boolean) => void) | null = null;
  let clerkListener: (() => void) | null = null;
  let resolveLoad!: () => void;
  let rejectLoad!: (e: Error) => void;
  let loadSignal: AbortSignal | null = null;
  const state = { clerkSession: false, supabaseSession: false };

  const deps = {
    clerkPhase: opts.clerkPhase,
    loadClerk: vi.fn((signal: AbortSignal) => {
      loadSignal = signal;
      return new Promise<void>((res, rej) => {
        resolveLoad = res;
        rejectLoad = rej;
      });
    }),
    hasClerkSession: () => state.clerkSession,
    subscribeClerk: vi.fn((cb: () => void) => {
      clerkListener = cb;
      return vi.fn(() => {
        clerkListener = null;
      });
    }),
    subscribeSupabase: vi.fn((cb: (event: string, has: boolean) => void) => {
      supabaseListener = cb;
      return vi.fn(() => {
        supabaseListener = null;
      });
    }),
    getSupabaseSession: vi.fn(async () => state.supabaseSession),
    fetchProfile: vi.fn(async () => {
      const p = opts.profile ?? { role: 'owner' };
      return typeof p === 'function' ? p() : p;
    }),
    setUser: vi.fn(),
    settle: vi.fn(),
  };

  const handle = startSessionRestore<User>(deps);
  return {
    deps,
    handle,
    state,
    supabaseInitial: (has = false) => supabaseListener?.('INITIAL_SESSION', has),
    supabaseEvent: (event: string, has: boolean) => supabaseListener?.(event, has),
    clerkLoaded: async () => {
      resolveLoad();
      await flush();
    },
    clerkFailed: async () => {
      rejectLoad(new Error('network'));
      await flush();
    },
    fireClerk: async () => {
      clerkListener?.();
      await flush();
    },
    get clerkListenerAttached() {
      return clerkListener !== null;
    },
    get supabaseListenerAttached() {
      return supabaseListener !== null;
    },
    get loadSignal() {
      return loadSignal;
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('startSessionRestore — a signed-in reload', () => {
  it('owner on a full page load: Supabase reports nothing first, Clerk arrives later → signed in, never signed out', async () => {
    const h = harness({ clerkPhase: 'loading', profile: { role: 'owner' } });
    h.supabaseInitial(false);
    await flush();

    // The exact moment the bug used to redirect to /login.
    expect(h.deps.setUser).not.toHaveBeenCalled();
    expect(h.deps.settle).not.toHaveBeenCalled();
    expect(h.clerkListenerAttached).toBe(false);

    h.state.clerkSession = true;
    await h.clerkLoaded();

    expect(h.clerkListenerAttached).toBe(true);
    expect(h.deps.fetchProfile).toHaveBeenCalledTimes(1);
    expect(h.deps.setUser).toHaveBeenCalledTimes(1);
    expect(h.deps.setUser).toHaveBeenCalledWith({ role: 'owner' });
    expect(h.deps.settle).toHaveBeenCalledTimes(1);
  });

  it.each(['tenant', 'admin', 'manager'])('%s reload restores the same way', async (role) => {
    const h = harness({ clerkPhase: 'loading', profile: { role } });
    h.supabaseInitial(false);
    h.state.clerkSession = true;
    await h.clerkLoaded();
    expect(h.deps.setUser).toHaveBeenLastCalledWith({ role });
    expect(h.deps.setUser).not.toHaveBeenCalledWith(null);
  });

  it('Clerk finishing before Supabase reports still waits for Supabase, then restores', async () => {
    const h = harness({ clerkPhase: 'loading' });
    h.state.clerkSession = true;
    await h.clerkLoaded();
    expect(h.deps.settle).not.toHaveBeenCalled();
    h.supabaseInitial(false);
    await flush();
    expect(h.deps.setUser).toHaveBeenCalledWith({ role: 'owner' });
    expect(h.deps.settle).toHaveBeenCalledTimes(1);
  });

  it('Clerk already loaded in the page (in-app navigation) attaches the listener at once', async () => {
    const h = harness({ clerkPhase: 'ready' });
    expect(h.clerkListenerAttached).toBe(true);
    expect(h.deps.loadClerk).not.toHaveBeenCalled();
    h.state.clerkSession = true;
    h.supabaseInitial(false);
    await flush();
    expect(h.deps.setUser).toHaveBeenCalledWith({ role: 'owner' });
  });

  it('a pre-Clerk Supabase session restores immediately, without waiting on Clerk', async () => {
    const h = harness({ clerkPhase: 'loading', profile: { role: 'tenant' } });
    h.supabaseInitial(true);
    await flush();
    expect(h.deps.setUser).toHaveBeenCalledWith({ role: 'tenant' });
    expect(h.deps.settle).toHaveBeenCalledTimes(1);
  });
});

describe('startSessionRestore — genuinely signed out, missing config, failures', () => {
  it('signed out once Clerk loads with no session', async () => {
    const h = harness({ clerkPhase: 'loading' });
    h.supabaseInitial(false);
    await h.clerkLoaded();
    expect(h.deps.setUser).toHaveBeenCalledWith(null);
    expect(h.deps.settle).toHaveBeenCalledTimes(1);
    expect(h.deps.fetchProfile).not.toHaveBeenCalled();
  });

  it.each<ClerkRestorePhase>(['not-configured', 'skipped'])('Clerk %s: signed out at once, Clerk never loaded', async (clerkPhase) => {
    const h = harness({ clerkPhase });
    h.supabaseInitial(false);
    await flush();
    expect(h.deps.loadClerk).not.toHaveBeenCalled();
    expect(h.clerkListenerAttached).toBe(false);
    expect(h.deps.setUser).toHaveBeenCalledWith(null);
    expect(h.deps.settle).toHaveBeenCalledTimes(1);
  });

  it('Clerk failing to load fails closed to signed out — no permanent loading', async () => {
    const h = harness({ clerkPhase: 'loading' });
    h.supabaseInitial(false);
    await h.clerkFailed();
    expect(h.deps.setUser).toHaveBeenCalledWith(null);
    expect(h.deps.settle).toHaveBeenCalledTimes(1);
    expect(h.clerkListenerAttached).toBe(false);
  });

  it('Clerk hanging times out to signed out — no permanent loading', async () => {
    const h = harness({ clerkPhase: 'loading' });
    h.supabaseInitial(false);
    vi.advanceTimersByTime(CLERK_RESTORE_TIMEOUT_MS - 1);
    expect(h.deps.settle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.deps.setUser).toHaveBeenCalledWith(null);
    expect(h.deps.settle).toHaveBeenCalledTimes(1);
  });

  it('a Clerk load that lands after the timeout still restores the session', async () => {
    const h = harness({ clerkPhase: 'loading' });
    h.supabaseInitial(false);
    vi.advanceTimersByTime(CLERK_RESTORE_TIMEOUT_MS);
    expect(h.deps.setUser).toHaveBeenLastCalledWith(null);
    h.state.clerkSession = true;
    await h.clerkLoaded();
    expect(h.clerkListenerAttached).toBe(true);
    expect(h.deps.setUser).toHaveBeenLastCalledWith({ role: 'owner' });
  });

  it('a /auth/me failure (no Stayo profile, disabled account) is signed out, not stuck loading', async () => {
    const h = harness({ clerkPhase: 'ready', profile: () => Promise.reject(new Error('401')) });
    h.state.clerkSession = true;
    h.supabaseInitial(false);
    await flush();
    expect(h.deps.setUser).toHaveBeenCalledWith(null);
    expect(h.deps.settle).toHaveBeenCalledTimes(1);
  });

  it('the role is whatever /auth/me says — a Clerk session alone sets no user', async () => {
    const h = harness({ clerkPhase: 'ready', profile: { role: 'tenant' } });
    h.state.clerkSession = true;
    h.supabaseInitial(false);
    await flush();
    expect(h.deps.fetchProfile).toHaveBeenCalledTimes(1);
    expect(h.deps.setUser.mock.calls.every(([u]) => u === null || u.role === 'tenant')).toBe(true);
  });
});

describe('startSessionRestore — listeners, cleanup and races', () => {
  it('a later Clerk sign-out is heard and signs the user out', async () => {
    const h = harness({ clerkPhase: 'ready' });
    h.state.clerkSession = true;
    h.supabaseInitial(false);
    await flush();
    h.state.clerkSession = false;
    await h.fireClerk();
    expect(h.deps.setUser).toHaveBeenLastCalledWith(null);
  });

  it('a Supabase SIGNED_OUT while a Clerk session lives is not a sign-out of the person', async () => {
    const h = harness({ clerkPhase: 'ready' });
    h.state.clerkSession = true;
    h.supabaseInitial(true);
    await flush();
    h.supabaseEvent('SIGNED_OUT', false);
    await flush();
    expect(h.deps.setUser).not.toHaveBeenCalledWith(null);
  });

  it('dispose detaches every listener, aborts the Clerk wait and ignores late results', async () => {
    const h = harness({ clerkPhase: 'loading' });
    h.supabaseInitial(false);
    h.handle.dispose();
    expect(h.supabaseListenerAttached).toBe(false);
    expect(h.loadSignal?.aborted).toBe(true);

    h.state.clerkSession = true;
    await h.clerkLoaded();
    vi.advanceTimersByTime(CLERK_RESTORE_TIMEOUT_MS * 2);
    expect(h.clerkListenerAttached).toBe(false);
    expect(h.deps.subscribeClerk).not.toHaveBeenCalled();
    expect(h.deps.setUser).not.toHaveBeenCalled();
    expect(h.deps.settle).not.toHaveBeenCalled();
  });

  it('dispose after the listener is attached unsubscribes it', async () => {
    const h = harness({ clerkPhase: 'loading' });
    h.supabaseInitial(false);
    await h.clerkLoaded();
    expect(h.clerkListenerAttached).toBe(true);
    h.handle.dispose();
    expect(h.clerkListenerAttached).toBe(false);
  });

  it('attaches the Clerk listener exactly once', async () => {
    const h = harness({ clerkPhase: 'loading' });
    h.supabaseInitial(false);
    vi.advanceTimersByTime(CLERK_RESTORE_TIMEOUT_MS);
    await h.clerkLoaded();
    await h.fireClerk();
    expect(h.deps.subscribeClerk).toHaveBeenCalledTimes(1);
  });

  it('a profile fetch overtaken by a sign-in or sign-out cannot overwrite it', async () => {
    let release!: (u: User) => void;
    const h = harness({ clerkPhase: 'ready', profile: () => new Promise<User>((r) => { release = r; }) });
    h.state.clerkSession = true;
    h.supabaseInitial(false);
    await flush();
    h.handle.supersede(); // e.g. logout() set the user to null meanwhile
    release({ role: 'owner' });
    await flush();
    expect(h.deps.setUser).not.toHaveBeenCalled();
  });

  it('only the newest of two overlapping profile fetches is applied', async () => {
    const releases: Array<(u: User) => void> = [];
    const h = harness({ clerkPhase: 'ready', profile: () => new Promise<User>((r) => releases.push(r)) });
    h.state.clerkSession = true;
    h.supabaseInitial(false);
    await h.fireClerk();
    expect(releases).toHaveLength(2);
    releases[1]({ role: 'owner' });
    releases[0]({ role: 'stale' });
    await flush();
    expect(h.deps.setUser).toHaveBeenCalledTimes(1);
    expect(h.deps.setUser).toHaveBeenCalledWith({ role: 'owner' });
  });
});

describe('signedInLoginRedirect — /login is only for people who need to sign in', () => {
  it('sends owners, admins and managers to their apps, as before', () => {
    expect(signedInLoginRedirect({ role: 'OWNER', justSignedIn: false })).toBe('/owner/home');
    expect(signedInLoginRedirect({ role: 'admin', justSignedIn: true })).toBe('/admin');
    expect(signedInLoginRedirect({ role: 'MANAGER', justSignedIn: false })).toBe('/admin');
  });

  it('sends an already-signed-in tenant to their dashboard, or to Discover without a tenancy', () => {
    expect(signedInLoginRedirect({ role: 'TENANT', tenantId: 't-1', justSignedIn: false })).toBe('/tenant/home');
    expect(signedInLoginRedirect({ role: 'tenant', tenantId: null, justSignedIn: false })).toBe('/discover');
  });

  it("leaves a tenant who just signed in on /login to the page's own announced hand-off", () => {
    expect(signedInLoginRedirect({ role: 'tenant', tenantId: 't-1', justSignedIn: true })).toBeNull();
  });

  it('does nothing for an unknown role', () => {
    expect(signedInLoginRedirect({ role: 'warden', justSignedIn: false })).toBeNull();
    expect(signedInLoginRedirect({ role: undefined, justSignedIn: false })).toBeNull();
  });
});

// ── Reopening Stayo (2026-10-10) ─────────────────────────────────────────────
//
// The installed app's start_url is "/", and reopening the site lands there too.
// "/" is a public page: it never sent a restored user anywhere and always
// showed "Log in", so every reopen looked like being signed out.

describe('signedInEntryRedirect — reopening Stayo lands on /', () => {
  const at = (pathname: string, role: string, extra: { tenantId?: string | null; justSignedIn?: boolean } = {}) =>
    signedInEntryRedirect({ pathname, role, tenantId: extra.tenantId ?? null, justSignedIn: extra.justSignedIn ?? false });

  it('sends a restored owner, admin and manager from / to their app', () => {
    expect(at('/', 'OWNER')).toBe('/owner/home');
    expect(at('/', 'ADMIN')).toBe('/admin');
    expect(at('/', 'MANAGER')).toBe('/admin');
  });

  it('sends a restored resident with a tenancy from / to the tenant dashboard', () => {
    expect(at('/', 'TENANT', { tenantId: 't-1' })).toBe('/tenant/home');
  });

  it('leaves a seeker with no tenancy on / — it is where they browse', () => {
    expect(at('/', 'TENANT')).toBeNull();
  });

  it("does not pre-empt the homepage's own announced hand-off right after signing in there", () => {
    expect(at('/', 'OWNER', { justSignedIn: true })).toBeNull();
    expect(at('/', 'TENANT', { tenantId: 't-1', justSignedIn: true })).toBeNull();
  });

  it('keeps the /login rules unchanged', () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'TENANT']) {
      for (const tenantId of [null, 't-1']) {
        for (const justSignedIn of [true, false]) {
          expect(signedInEntryRedirect({ pathname: '/login', role, tenantId, justSignedIn })).toBe(
            signedInLoginRedirect({ role, tenantId, justSignedIn }),
          );
        }
      }
    }
  });

  it('never redirects from other pages, signed in or not', () => {
    for (const pathname of ['/owners', '/discover', '/welcome', '/owner/home', '/tenant/home', '/admin']) {
      expect(at(pathname, 'OWNER')).toBeNull();
      expect(at(pathname, 'TENANT', { tenantId: 't-1' })).toBeNull();
    }
  });

  it('does nothing for an unknown role', () => {
    expect(at('/', 'warden')).toBeNull();
    expect(at('/', '')).toBeNull();
  });
});

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

describe('the session hint — a boolean, never a credential', () => {
  it('is written on sign-in and removed on sign-out', () => {
    const storage = memoryStorage();
    writeSessionHint(storage, true);
    expect(storage.data.get(SESSION_HINT_KEY)).toBe('1');
    expect(readSessionHint(storage)).toBe(true);
    writeSessionHint(storage, false);
    expect(storage.data.has(SESSION_HINT_KEY)).toBe(false);
    expect(readSessionHint(storage)).toBe(false);
  });

  it('stores only "1" — no token, id or user data', () => {
    const storage = memoryStorage();
    writeSessionHint(storage, true);
    expect([...storage.data.entries()]).toEqual([[SESSION_HINT_KEY, '1']]);
  });

  it('survives unavailable storage without throwing', () => {
    const broken = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(readSessionHint(broken)).toBe(false);
    expect(() => writeSessionHint(broken, true)).not.toThrow();
    expect(readSessionHint(null)).toBe(false);
  });

  it('either signal is enough to look for a session; neither means an anonymous visit', () => {
    expect(maySessionExist({ cookieHeader: '__client_uat=1728460000', storage: memoryStorage() })).toBe(true);
    expect(maySessionExist({ cookieHeader: '', storage: memoryStorage({ [SESSION_HINT_KEY]: '1' }) })).toBe(true);
    expect(maySessionExist({ cookieHeader: '__client_uat=0', storage: memoryStorage() })).toBe(false);
    expect(maySessionExist({ cookieHeader: undefined, storage: null })).toBe(false);
  });

  it('a hint alone authorises nothing: it only decides whether Clerk is loaded to look', () => {
    expect(initialClerkPhase({ configured: true, mode: 'load-if-signed-in', alreadyLoaded: false, hasSignedInHint: true })).toBe('loading');
    expect(decideSessionResolution({ supabaseKnown: true, hasSupabaseSession: false, clerkPhase: 'ready', hasClerkSession: false })).toBe('signed-out');
  });
});

describe('close and reopen — the whole path, at "/"', () => {
  it('a signed-in owner reopening Stayo is restored before anything signs them out', async () => {
    // Reopen: public page, the hint from last time says a session may exist.
    const phase = initialClerkPhase({ configured: true, mode: 'load-if-signed-in', alreadyLoaded: false, hasSignedInHint: true });
    const h = harness({ clerkPhase: phase, profile: { role: 'owner' } });
    h.supabaseInitial(false);
    await flush();
    expect(h.deps.setUser).not.toHaveBeenCalled();
    h.state.clerkSession = true;
    await h.clerkLoaded();
    expect(h.deps.setUser).toHaveBeenCalledWith({ role: 'owner' });
    expect(signedInEntryRedirect({ pathname: '/', role: 'owner', justSignedIn: false })).toBe('/owner/home');
  });

  it('an expired or revoked session reopening Stayo ends signed out, and the hint can be cleared', async () => {
    const h = harness({ clerkPhase: 'loading' });
    h.supabaseInitial(false);
    await h.clerkLoaded(); // Clerk loaded, but its session is gone
    expect(h.deps.setUser).toHaveBeenCalledWith(null);
    expect(h.deps.settle).toHaveBeenCalledTimes(1);
  });

  it('an anonymous visitor to / never loads Clerk and never waits', async () => {
    const phase = initialClerkPhase({ configured: true, mode: 'load-if-signed-in', alreadyLoaded: false, hasSignedInHint: false });
    const h = harness({ clerkPhase: phase });
    h.supabaseInitial(false);
    await flush();
    expect(h.deps.loadClerk).not.toHaveBeenCalled();
    expect(h.deps.settle).toHaveBeenCalledTimes(1);
  });
});
