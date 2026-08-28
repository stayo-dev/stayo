import React, { createContext, useState, useContext, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import api from '@lib/api-client';
import { supabase } from '@lib/supabaseClient';
import { queryClient } from '@lib/queryClient';
import { useIdleSessionTimeout } from '@shared/hooks/useIdleSessionTimeout';
import { clearIntentionalSignOut, markIntentionalSignOut } from '@lib/sessionSignOutIntent';

export interface AuthUser {
  email?: string;
  role: string;
  name?: string;
  id?: string;
  owner_id?: string;
  tenant_id?: string;
  hostel_id?: string;
  is_profile_completed?: boolean;
  /**
   * `tenants.status` for this person's current tenancy (`INVITED`/`ACTIVE`/
   * `FORMER_TENANT`/`EXPIRED`/`CANCELLED`), or `null` for a TENANT-role
   * account with no tenancy at all (a Discover-only marketplace account).
   * Drives the app-wide nav's Explore/Dashboard/Profile vs Explore/Profile
   * split — see `app/nav/useAppNav.ts`. Sourced from `/auth/me`'s
   * `extra.tenant_status`, which the backend already computed but this
   * context previously dropped on the floor.
   */
  tenant_status?: string | null;
  /**
   * LIVE / EXITING / EXITED / NONE — computed by `/api/auth/me`, which is the
   * only place that knows whether a departed tenant still has an unsettled
   * move-out. See `appNavConfig.ts::TenancyState` for why `tenant_status`
   * alone was not enough to gate dashboard access. (ADR-122)
   */
  tenancy_state?: string | null;
  /** The move-out to show on the read-only dashboard and farewell screen. */
  exit_request_id?: string | null;
  phone?: string | null;
  phone_verified?: boolean;
}

/**
 * Read by `AuthCallbackPage` after the full-page Google redirect returns —
 * `sessionStorage` because in-memory state (a callback, a promise) cannot
 * survive navigating away to Google and back. `_PROVISION` marks "this
 * attempt is allowed to create a new account if none exists"; `_RETURN_TO`
 * is the page to send the person back to afterward (e.g. the enquiry they
 * were filling in) rather than a generic landing page.
 */
export const GOOGLE_PROVISION_INTENT_KEY = 'stayo_auth_google_provision';
export const GOOGLE_RETURN_TO_KEY = 'stayo_auth_return_to';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  /**
   * ADR-031: signInWithOAuth is a full-page redirect (Google → Supabase →
   * back to /auth/callback), so this can't resolve with an AuthUser the
   * way the old popup-code-flow version did — the browser navigates away
   * before anything could come back. AuthCallbackPage picks the session up
   * afterward via the auth-state listener below.
   */
  loginWithGoogle: () => Promise<void>;
  /**
   * Google sign-in that also creates a new Stayo account when the email has
   * none yet (2026-08-16) — see the function's own doc comment. Owner mode
   * must never call this.
   */
  loginWithGoogleAllowProvision: (returnTo?: string) => Promise<void>;
  /**
   * Self-serve tenant signup (ADR-035) — creates a marketplace account and
   * logs it straight in. Lives here rather than in a feature API wrapper
   * because `shared/ui-patterns/LoginModal` is its caller and shared code
   * may not import `@features/*` (scripts/check-architecture.mjs), and
   * because minting a session is this context's job either way.
   *
   * `phone` is optional (ADR-096): the Sign Up tab asks for name, email and
   * password only, and the number is collected and verified later, when an
   * enquiry is actually sent.
   */
  signUpTenant: (data: { name: string; email: string; password: string; phone?: string }) => Promise<AuthUser>;
  updateUser: (patch: Partial<AuthUser>) => void;
  logout: (redirect?: boolean, options?: LogoutOptions) => void | Promise<void>;
}

type LogoutOptions = {
  preserveSessionNotice?: boolean;
};

type SessionExpiryReason = 'inactive' | 'max_age' | 'reuse' | 'expired';

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * The credentials were accepted but `supabase.auth.setSession()` refused the
 * tokens — an environment/configuration fault (e.g. backend and frontend on
 * different Supabase projects), not a network or password problem. Its own
 * type exists so the login catch can say something true about it instead of
 * falling through to the "no `.response`" branch and blaming the network.
 */
class SessionEstablishmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionEstablishmentError';
  }
}

const normalizeRole = (role: unknown) => (role || '').toString().toLowerCase();

const LOGIN_ERROR_MAP: Record<number, string> = {
  401: 'Incorrect email or password',
  403: 'You do not have access to this account.',
  404: 'Account not found',
  429: 'Too many login attempts. Try again later.',
  500: 'Something went wrong. Please try again.',
};

const getApiErrorMessage = (error: unknown): string | null => {
  const data = (error as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (!data) return null;
  if (data.error && typeof data.error === 'object' && 'message' in data.error)
    return (data.error as { message: string }).message;
  if (typeof data.message === 'string') return data.message;
  return null;
};

const SESSION_EXPIRY_NOTICE_KEY = 'hms_session_expiry_notice';
const INACTIVITY_EXPIRED_MESSAGE =
  'You were signed out after a long time away. Sign in again to pick up where you left off.';

const persistSessionExpiryNotice = (
  message: string,
  reason: SessionExpiryReason = 'expired',
) => {
  try {
    sessionStorage.setItem(
      SESSION_EXPIRY_NOTICE_KEY,
      JSON.stringify({ message, reason }),
    );
  } catch {
    /* sessionStorage may be unavailable in strict privacy modes */
  }
};

// ADR-031: no more ownerUser/tenantUser localStorage persistence — Supabase
// persists its own session (its client is configured with persistSession:
// true), and the profile is re-hydrated from GET /auth/me on every auth
// state change instead. This clears what's left: the onboarding-flow keys
// and (optionally) the session-expiry notice.
const clearSessionScopedStorage = (options: LogoutOptions = {}) => {
  const preservedNotice = options.preserveSessionNotice
    ? sessionStorage.getItem(SESSION_EXPIRY_NOTICE_KEY)
    : null;
  localStorage.removeItem('hms_onboarding_step');
  localStorage.removeItem('sri_adithya_onboarding_complete');
  sessionStorage.clear();
  if (preservedNotice) sessionStorage.setItem(SESSION_EXPIRY_NOTICE_KEY, preservedNotice);
};

function buildAuthUser(data: any): AuthUser {
  return {
    email: data.email,
    role: normalizeRole(data.role),
    name: data.name,
    id: data.user_id,
    owner_id: data.owner_id,
    tenant_id: data.tenant_id,
    hostel_id: data.hostel_id,
    is_profile_completed: data.is_profile_completed,
    tenant_status: data.tenant_status ?? null,
    tenancy_state: data.tenancy_state ?? null,
    exit_request_id: data.exit_request_id ?? null,
    phone: data.phone ?? null,
    phone_verified: Boolean(data.phone_verified),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [expiredMessage, setExpiredMessage] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const logout = async (redirect = true, options: LogoutOptions = {}) => {
    // Before the request, not after: logout revokes the session server-side, so
    // anything already in flight 401s as SESSION_REVOKED and would otherwise
    // raise "Session expired for your security" on a sign-out the user chose.
    markIntentionalSignOut();
    try {
      await api.post('/auth/logout');
    } catch {
      /* clear local session even if server logout fails */
    }
    await supabase.auth.signOut();
    setUser(null);
    queryClient.clear();
    clearSessionScopedStorage(options);
    if (redirect) navigate('/', { replace: true });
  };

  const { showIdleWarning, staySignedIn } = useIdleSessionTimeout({
    isActive: Boolean(user),
    onIdleTimeout: () => {
      setExpiredMessage(INACTIVITY_EXPIRED_MESSAGE);
      persistSessionExpiryNotice(INACTIVITY_EXPIRED_MESSAGE, 'inactive');
      logout(false, { preserveSessionNotice: true });
    },
  });

  const updateUser = (patch: Partial<AuthUser>) => {
    setUser((current) => (current ? { ...current, ...patch } : current));
  };

  useEffect(() => {
    const publicPaths = ['/login'];
    if (user && publicPaths.includes(location.pathname)) {
      const role = user.role?.toLowerCase();
      if (role === 'admin') {
        navigate('/admin', { replace: true });
      } else if (role === 'owner') {
        navigate('/owner/home', { replace: true });
      }
    }
  }, [user, location.pathname, navigate]);

  // ADR-031: Supabase's client owns session persistence/refresh — this
  // effect only reacts to it. `onAuthStateChange` fires immediately once
  // with the current session (INITIAL_SESSION) and again on every
  // SIGNED_IN/TOKEN_REFRESHED/SIGNED_OUT. Each time a session appears, the
  // app-specific bits (role, owner_id, tenant_id, name — Supabase's own
  // session object knows none of this) are fetched from GET /auth/me.
  useEffect(() => {
    let mounted = true;

    const hydrate = async () => {
      try {
        const response = await api.get('/auth/me');
        if (mounted) setUser(buildAuthUser(response.data));
      } catch {
        if (mounted) setUser(null);
      }
    };

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setLoading(false);
        return;
      }
      if (session) {
        hydrate().finally(() => {
          if (mounted) setLoading(false);
        });
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string): Promise<AuthUser> => {
    // A new session gets no leftover grace from the previous sign-out.
    clearIntentionalSignOut();
    try {
      const normalizedEmail = (email || '').trim().toLowerCase();
      const response = await api.post('/auth/login', {
        email: normalizedEmail,
        password,
      });
      queryClient.clear();
      clearSessionScopedStorage();

      const { access_token, refresh_token } = response.data;
      const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
      // Marked so the catch below doesn't mislabel it. A setSession failure
      // means Supabase itself rejected the token the backend just minted —
      // in production that turned out to be the backend verifying against a
      // different Supabase project — and reporting it as "check your
      // internet" sent debugging in exactly the wrong direction for hours.
      if (sessionError) throw new SessionEstablishmentError(sessionError.message);

      // Built directly from /auth/login's own response rather than waiting
      // on the auth-state listener's GET /auth/me round-trip, so the
      // caller (LoginPage's navigateForUser) can navigate immediately. The
      // listener above will also fire and re-hydrate — harmless, one extra
      // GET.
      const userData = buildAuthUser({ ...response.data, email: normalizedEmail });
      setUser(userData);
      return userData;
    } catch (error: unknown) {
      if (error instanceof SessionEstablishmentError) {
        throw new Error(
          'Signed in, but this device could not start a secure session. ' +
            'This is a server configuration problem, not your connection — please report it.',
        );
      }
      if (!(error as { response?: unknown })?.response) {
        throw new Error('Unable to connect. Check your internet.');
      }
      const status = (error as { response?: { status?: number } })?.response?.status;
      const serverMessage = getApiErrorMessage(error);
      throw new Error(
        serverMessage || LOGIN_ERROR_MAP[status ?? 0] || 'Something went wrong.',
      );
    }
  };

  const signUpTenant = async (data: {
    name: string;
    email: string;
    password: string;
    phone?: string;
  }): Promise<AuthUser> => {
    try {
      const normalizedEmail = data.email.trim().toLowerCase();
      const phone = data.phone?.trim();
      // Same response/cookie shape as /auth/login, so the session handling
      // below is deliberately identical to login()'s.
      //
      // `phone` is omitted entirely when there isn't one — sending `""` would
      // fail the backend's min-length check, and sending an unverified number
      // would trip its OTP gate.
      const response = await api.post('/auth/tenant-signup', {
        name: data.name.trim(),
        email: normalizedEmail,
        password: data.password,
        ...(phone ? { phone } : {}),
      });
      queryClient.clear();
      clearSessionScopedStorage();

      const { access_token, refresh_token } = response.data;
      const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
      if (sessionError) throw new Error(sessionError.message);

      const userData = buildAuthUser({ ...response.data, email: normalizedEmail });
      setUser(userData);
      return userData;
    } catch (error: unknown) {
      if (!(error as { response?: unknown })?.response) {
        throw new Error('Unable to connect. Check your internet.');
      }
      throw new Error(getApiErrorMessage(error) || 'Could not create your account.');
    }
  };

  const loginWithGoogle = async (): Promise<void> => {
    queryClient.clear();
    clearSessionScopedStorage();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) throw new Error(error.message || 'Google authentication failed');
    // No further code runs — signInWithOAuth navigates the browser away.
  };

  /**
   * Same redirect as `loginWithGoogle()`, but marks this attempt as allowed
   * to create a brand-new Stayo account if the email has none yet
   * (`AuthCallbackPage` reads `GOOGLE_PROVISION_INTENT_KEY` on return and
   * calls `POST /api/auth/google/provision` only when it's set). Owner mode
   * must never call this — only `mode="tenant"` in `LoginModal` does.
   * `returnTo` defaults to the current page so a visitor mid-enquiry lands
   * back on it, not a generic landing page.
   */
  const loginWithGoogleAllowProvision = async (returnTo?: string): Promise<void> => {
    try {
      sessionStorage.setItem(GOOGLE_PROVISION_INTENT_KEY, '1');
      sessionStorage.setItem(GOOGLE_RETURN_TO_KEY, returnTo || `${window.location.pathname}${window.location.search}`);
    } catch {
      /* sessionStorage may be unavailable in strict privacy modes — provisioning still works, just without a return path */
    }
    await loginWithGoogle();
  };

  // Server-driven session termination (idle timeout past the app's own
  // 30-min rule, or a Redis-revoked session) — distinct from client-side
  // idle detection, which lives in useIdleSessionTimeout. Dispatched by
  // lib/api-client.ts's response interceptor as a plain window event so the
  // API layer stays decoupled from React state. Supabase itself is already
  // signed out by the time this fires (api-client.ts does that before
  // dispatching).
  useEffect(() => {
    const onExpired = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; reason?: SessionExpiryReason }>).detail;
      const message =
        detail?.message ||
        'You were signed out because your secure session ended. Please sign in again.';
      setExpiredMessage(message);
      persistSessionExpiryNotice(message, detail?.reason || 'expired');
      setUser(null);
      queryClient.clear();
      clearSessionScopedStorage({ preserveSessionNotice: true });
    };

    window.addEventListener('hms:session-expired', onExpired);
    return () => window.removeEventListener('hms:session-expired', onExpired);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, loginWithGoogle, loginWithGoogleAllowProvision, signUpTenant, updateUser, logout, loading }}>
      {children}
      {showIdleWarning && user && (
        <SessionSecurityModal
          title="Still there?"
          message="You’ve been away a while. This session will end in 5 minutes — stay signed in to keep going."
          details={[
            'Nothing is lost — stay signed in and carry on.',
            'This only happens after a long time away.',
          ]}
          primaryLabel="Stay signed in"
          secondaryLabel="Sign out"
          onPrimary={staySignedIn}
          onSecondary={() => logout()}
        />
      )}
      {expiredMessage && !user && (
        <SessionSecurityModal
          title="Welcome back"
          message={expiredMessage}
          details={[
            'Your data is exactly where you left it.',
            'Signing in again takes a moment.',
          ]}
          primaryLabel="Sign in again"
          secondaryLabel="Return to homepage"
          onPrimary={() => {
            setExpiredMessage(null);
            navigate('/login?signin=1', {
              replace: true,
              state: { sessionExpired: true, sessionMessage: expiredMessage },
            });
          }}
          onSecondary={() => {
            setExpiredMessage(null);
            navigate('/', { replace: true });
          }}
        />
      )}
    </AuthContext.Provider>
  );
}

function SessionSecurityModal({
  title,
  message,
  details,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
}: {
  title: string;
  message: string;
  details: string[];
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  return (
    /*
      Stayo's own language — the warm cream surface, terracotta primary and
      display face used across onboarding and Discover — rather than the
      generic bordered box this was.
      
      The tone changed with it. "Session expired for your security" and three
      bullets about payment protection read like a bank telling someone off for
      stepping away. Nothing was wrong and nothing was at risk; they were simply
      gone a while. The primary action is now the friendly one and it is on the
      right, where the thumb already is.
    */
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center px-4 pb-4 sm:items-center sm:pb-0"
      style={{ background: 'rgba(20,16,13,.5)' }}
    >
      <div
        className="w-full max-w-[420px] rounded-[22px] sm:rounded-[22px]"
        style={{
          background: '#FBF7F1',
          border: '1px solid #EFE6DA',
          boxShadow: '0 20px 45px -20px rgba(40,30,20,.35)',
          padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
        }}
      >
        <div
          className="mb-3.5 flex h-11 w-11 items-center justify-center rounded-[14px]"
          style={{ background: 'rgba(180,106,85,.12)' }}
        >
          <LogIn className="h-[21px] w-[21px]" strokeWidth={1.9} style={{ color: '#B46A55' }} />
        </div>

        <h2 className="font-display text-[19px] font-extrabold tracking-tight" style={{ color: '#221E1A' }}>
          {title}
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: '#7A6F63' }}>
          {message}
        </p>

        <div className="mt-3.5 flex flex-col gap-1.5 rounded-xl px-3.5 py-3" style={{ background: '#F3EEE7' }}>
          {details.map((detail) => (
            <div key={detail} className="flex gap-2 text-[12px] leading-snug" style={{ color: '#5A5147' }}>
              <span className="mt-[7px] h-1 w-1 flex-none rounded-full" style={{ background: '#B46A55' }} />
              <span>{detail}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            onClick={onSecondary}
            className="rounded-xl px-4 py-3 text-[13.5px] font-bold"
            style={{ background: '#FFFFFF', border: '1px solid #E7DDD1', color: '#221E1A' }}
          >
            {secondaryLabel}
          </button>
          <button
            type="button"
            onClick={onPrimary}
            className="flex-1 rounded-xl py-3 text-[13.5px] font-bold text-white"
            style={{ background: '#B46A55', boxShadow: '0 6px 16px rgba(180,106,85,.3)' }}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
