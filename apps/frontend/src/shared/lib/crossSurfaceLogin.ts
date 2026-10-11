/**
 * Where someone goes after signing in on a surface that isn't theirs.
 *
 * Stayo has one login component on several doors: the homepage, Discovery
 * (seekers and tenants) and the owner site. Nothing stops an owner signing in
 * from Discovery, or a tenant from the owner page. Each account is sent
 * straight to its own dashboard.
 *
 * This used to show a "Signed in — taking you to your … dashboard" card for
 * 1.6s before the redirect. Every owner, admin, manager and tenant saw it on
 * every login, so it read as a stall rather than reassurance, and it is gone
 * (2026-10-11). Only the destination is decided here.
 *
 * PURE — runs under vitest's node environment.
 */

/**
 * `home` is the homepage at `/`: the same seeker-facing door as Discovery,
 * except that a resident with a tenancy came to reach their stay — the home
 * page is the app's launch screen, not where they browse.
 */
export type LoginSurface = 'discovery' | 'home' | 'owner';

export interface CrossSurfaceHandoff {
  /** Where this account actually belongs. */
  path: string;
}

export interface LoginAccount {
  role?: string | null;
  /** Present when the account has a tenancy — a tenant, not just a seeker. */
  tenantId?: string | null;
}

/**
 * The handoff for an account that signed in on the other side, or null when
 * the person is already where they belong and nothing needs saying.
 */
export function crossSurfaceHandoff(
  account: LoginAccount,
  surface: LoginSurface,
): CrossSurfaceHandoff | null {
  const role = String(account.role ?? '').toLowerCase();

  if (surface === 'discovery' || surface === 'home') {
    // An owner, admin or manager who signed in here wants their own app.
    if (role === 'owner') {
      return { path: '/owner/home' };
    }
    if (role === 'admin') {
      return { path: '/admin' };
    }
    if (role === 'manager') {
      return { path: '/admin' };
    }
    // A resident with a tenancy signing in on the homepage wants their stay.
    if (surface === 'home' && role === 'tenant' && account.tenantId) {
      return { path: '/tenant/home' };
    }
    // A seeker — or a resident signing in on Discovery — is exactly where
    // they should be.
    return null;
  }

  // On the owner site: a resident account belongs on the other side.
  if (role === 'tenant') {
    return account.tenantId
      ? { path: '/tenant/home' }
      : { path: '/discover' };
  }
  return null;
}

