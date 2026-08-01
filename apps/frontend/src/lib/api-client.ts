import axios from 'axios';
import { supabase } from './supabaseClient';

// StayO requires an explicit API base URL in every environment (dev, staging,
// production) via VITE_API_URL — no hardcoded host, no silent fallback. See
// apps/frontend/.env.example for how to set it locally.
const configuredApiUrl = import.meta.env.VITE_API_URL;

if (typeof configuredApiUrl !== 'string' || !configuredApiUrl.trim()) {
  throw new Error(
    'VITE_API_URL is not set. StayO requires an explicit API base URL in every environment ' +
      '(development, staging, production) — see apps/frontend/.env.example.',
  );
}

const normalizeApiUrl = (value: string) => {
  const trimmed = value.trim().replace(/\/+$/, '');

  // A same-origin path (e.g. "/api") is the preferred production setup: the
  // Vercel rewrite in vercel.json proxies it to the backend, so requests stay
  // first-party and the CSRF cookie (SameSite=Lax) is actually sent. `new URL`
  // throws on a relative value, so it has to be handled before that.
  if (trimmed.startsWith('/')) return trimmed || '/api';

  const parsed = new URL(trimmed);
  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/') return `${parsed.origin}/api`;
  if (pathname.toLowerCase() === '/api') return `${parsed.origin}/api`;
  return `${parsed.origin}${pathname}`;
};

const baseURL = normalizeApiUrl(configuredApiUrl);

const api = axios.create({
  baseURL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

let inMemoryCsrfToken: string | null = null;
let csrfBootstrapPromise: Promise<string | null> | null = null;
const CSRF_COOKIE_NAME = 'hms_csrf';
const CSRF_HEADER_NAME = 'X-CSRF-Token';

const getCookieValue = (name: string) => {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
};

const isUnsafeMethod = (method?: string) =>
  ['post', 'put', 'patch', 'delete'].includes(String(method || 'get').toLowerCase());

const attachCsrfHeader = (headers: any, method?: string) => {
  if (!isUnsafeMethod(method)) return;
  const csrfToken = getCookieValue(CSRF_COOKIE_NAME) || inMemoryCsrfToken;
  if (csrfToken) headers[CSRF_HEADER_NAME] = csrfToken;
};

const isPublicAuthRequest = (url?: string) =>
  [
    '/auth/login',
    '/auth/onboarding-login',
    '/auth/register',
    '/auth/owner-signup',
    '/auth/send-otp',
    '/auth/verify-otp',
    '/auth/send-phone-otp',
    '/auth/verify-phone-otp',
    '/auth/csrf',
    '/leads/self-serve',
    '/leads/invitation',
  ].some((path) => String(url || '').includes(path));

const rememberCsrfToken = (headers?: any) => {
  const token =
    headers?.[CSRF_HEADER_NAME] ||
    headers?.[CSRF_HEADER_NAME.toLowerCase()] ||
    headers?.get?.(CSRF_HEADER_NAME) ||
    headers?.get?.(CSRF_HEADER_NAME.toLowerCase());
  if (token) inMemoryCsrfToken = String(token);
  return inMemoryCsrfToken;
};

const refreshCsrfToken = async () => {
  inMemoryCsrfToken = null;
  csrfBootstrapPromise = null;
  return ensureCsrfToken();
};

const ensureCsrfToken = async () => {
  const existing = getCookieValue(CSRF_COOKIE_NAME) || inMemoryCsrfToken;
  if (existing) return existing;
  if (!csrfBootstrapPromise) {
    csrfBootstrapPromise = axios
      .get(`${baseURL}/auth/csrf`, { withCredentials: true })
      .then((response) => rememberCsrfToken(response.headers) || getCookieValue(CSRF_COOKIE_NAME))
      .catch(() => null)
      .finally(() => {
        csrfBootstrapPromise = null;
      });
  }
  return csrfBootstrapPromise;
};

type SessionExpiryReason = 'inactive' | 'max_age' | 'reuse' | 'expired';

type SessionExpiryNotice = {
  message: string;
  reason: SessionExpiryReason;
};

const getSessionExpiryNotice = (data?: any): SessionExpiryNotice => {
  const error = data?.error || {};
  const code = String(error.code || data?.code || '').toUpperCase();
  const serverMessage = String(error.message || data?.message || '');

  if (code === 'SESSION_INACTIVE' || /inactive|30 minutes/i.test(serverMessage)) {
    return {
      reason: 'inactive',
      message: 'You were signed out because your account was inactive for more than 30 minutes.',
    };
  }

  if (code === 'SESSION_REVOKED') {
    return {
      reason: 'expired',
      message: 'You were signed out because your secure session ended. Please sign in again.',
    };
  }

  return {
    reason: 'expired',
    message:
      serverMessage ||
      'You were signed out because your secure session ended. Please sign in again.',
  };
};

const notifySessionExpired = (notice?: Partial<SessionExpiryNotice> | string) => {
  if (typeof window === 'undefined') return;
  const normalizedNotice =
    typeof notice === 'string'
      ? { message: notice, reason: 'expired' as SessionExpiryReason }
      : notice;
  window.dispatchEvent(
    new CustomEvent('hms:session-expired', {
      detail: {
        message:
          normalizedNotice?.message ||
          'You were signed out because your secure session ended. Please sign in again.',
        reason: normalizedNotice?.reason || 'expired',
      },
    }),
  );
};

api.interceptors.request.use(
  async (config) => {
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      if (config.headers) delete config.headers['Content-Type'];
    }
    // ADR-031: the token comes from Supabase's own client-side session
    // (persisted + auto-refreshed by the SDK), not a custom in-memory
    // variable. `getSession()` returns the current session synchronously
    // from local storage and only hits the network if a refresh is due.
    if (!isPublicAuthRequest(config.url)) {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) {
        config.headers.Authorization = `Bearer ${data.session.access_token}`;
      }
    }
    if (isUnsafeMethod(config.method) && !isPublicAuthRequest(config.url)) await ensureCsrfToken();
    if (config.headers) attachCsrfHeader(config.headers, config.method);
    return config;
  },
  (error) => Promise.reject(error),
);

api.interceptors.response.use(
  (response) => {
    rememberCsrfToken(response.headers);
    return response;
  },
  async (error) => {
    // No refresh-retry here anymore (ADR-031) — Supabase's SDK refreshes
    // proactively and serializes concurrent refreshes itself, which also
    // fixes the N-parallel-refresh race the old custom retry-once logic
    // had. A 401 at this point means the server-side layer rejected an
    // otherwise-valid-looking Supabase token (SESSION_INACTIVE from the
    // app's own idle rule, or SESSION_REVOKED from the Redis deny-list) —
    // both cases Supabase itself can't know about, so sign out and let the
    // UI react to the same event it always has.
    const code = String(error.response?.data?.error?.code || '').toUpperCase();

    // A rejected CSRF token is recoverable, so recover instead of showing the
    // user "Security check failed". The token can legitimately go stale — it
    // is rotated at every auth boundary, and a browser may hold more than one
    // hms_csrf cookie — and the request itself was authenticated and
    // deliberate. Fetch a fresh pair and replay once; a second failure is a
    // real one and surfaces as before.
    const original = error.config as (typeof error.config & { _csrfRetried?: boolean }) | undefined;
    if (error.response?.status === 403 && code === 'CSRF_VALIDATION_FAILED' && original && !original._csrfRetried) {
      original._csrfRetried = true;
      const fresh = await refreshCsrfToken();
      if (fresh) {
        original.headers = original.headers || {};
        (original.headers as any)[CSRF_HEADER_NAME] = fresh;
        return api.request(original);
      }
    }

    if (error.response?.status === 401 && (code === 'SESSION_INACTIVE' || code === 'SESSION_REVOKED')) {
      await supabase.auth.signOut();
      notifySessionExpired(getSessionExpiryNotice(error.response?.data));
    }
    return Promise.reject(error);
  },
);

export default api;

export const publicApi = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
});

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const requestWithRetry = async <T>(
  fn: () => Promise<T>,
  { retries = 2, delayMs = 1500 }: { retries?: number; delayMs?: number } = {},
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = (error as { response?: { status?: number } })?.response?.status;
      const shouldRetry = !status || [502, 503, 504].includes(status);
      if (!shouldRetry || attempt === retries) throw error;
      await sleep(delayMs * (attempt + 1));
    }
  }
  throw lastError;
};
