/**
 * What happens when someone signs in on the wrong surface for their account.
 *
 * Stayo has one login component on two doors: Discovery (seekers and tenants)
 * and the owner site. Nothing stops an owner signing in from Discovery, or a
 * tenant from the owner page — and both used to be bounced to the other side
 * **silently**, mid-`window.location.assign`, with no explanation. Landing
 * somewhere you did not ask for, immediately after typing a password, reads
 * as a bug or a security fright rather than as routing.
 *
 * So the redirect still happens — it is the right destination, and refusing
 * the login would be worse — but it is announced first.
 *
 * PURE — runs under vitest's node environment.
 */

export type LoginSurface = 'discovery' | 'owner';

export interface CrossSurfaceHandoff {
  /** Where this account actually belongs. */
  path: string;
  /** Shown before the redirect, in the person's own terms. */
  message: string;
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

  if (surface === 'discovery') {
    // An owner or admin who signed in here wants their own app. Say so, then
    // take them.
    if (role === 'owner') {
      return {
        path: '/owner/home',
        message:
          "This account manages a hostel on Stayo, so we're taking you to your owner dashboard.",
      };
    }
    if (role === 'admin') {
      return { path: '/admin', message: "This is a Stayo admin account — opening the admin console." };
    }
    // A resident signing in on Discovery is exactly where they should be.
    return null;
  }

  // On the owner site: a resident account belongs on the other side.
  if (role === 'tenant') {
    return account.tenantId
      ? {
          path: '/tenant/home',
          message: "This account is a resident account, so we're opening your tenant dashboard.",
        }
      : {
          // v1 (ADR-170): no marketplace to browse, so a resident account
          // with no active tenancy lands on the shared Profile hub.
          path: '/profile',
          message: "This account is a resident account — opening your Stayo profile.",
        };
  }
  return null;
}

/**
 * How long the message stays up before the redirect.
 *
 * Long enough to read one sentence, short enough that it never feels like the
 * app has stalled after a successful login.
 */
export const HANDOFF_DELAY_MS = 1600;
