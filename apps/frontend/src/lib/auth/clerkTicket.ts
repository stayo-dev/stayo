/**
 * Redeem a backend-issued sign-in ticket with Clerk (ADR-204).
 *
 * The backend proves the password (and applies its rate limits and account
 * gates), then hands back a single-use ticket; this turns it into a real Clerk
 * session in the browser, using Clerk's `ticket` sign-in strategy. The browser
 * never gives Clerk the password itself.
 *
 * Clerk is loaded *here, on demand*, rather than by mounting a provider: sign-in
 * happens from `AuthContext`, which sits above every `ClerkProvider`, and from
 * the public landing page's login modal, which must not ship the SDK
 * (ADR-176 Phase 2.6). `loadClerkJsScript` is the same loader
 * `@clerk/clerk-react` uses, and it publishes `window.Clerk` — so when a
 * protected shell later mounts `ClerkProvider`, the provider finds the
 * already-loaded instance and reuses it instead of starting a second one.
 *
 * Only ever reached through a dynamic `import()`, so the loader stays out of
 * the entry chunk.
 */
import { readClerkConfig } from './clerkConfig';
import { decideExistingSession } from './existingClerkSession';

interface ClerkForTicket {
  loaded?: boolean;
  load: (options?: Record<string, unknown>) => Promise<void>;
  /** The active session, or null/undefined when this browser holds none. */
  session?: unknown;
  user?: { externalId?: string | null } | null;
  signOut: (callback?: () => void | Promise<unknown>) => Promise<void>;
  client?: {
    signIn: {
      create: (params: { strategy: 'ticket'; ticket: string }) => Promise<{
        status: string | null;
        createdSessionId: string | null;
      }>;
    };
  };
  setActive: (params: { session: string }) => Promise<void>;
}

function clerkGlobal(): ClerkForTicket | undefined {
  return (window as unknown as { Clerk?: ClerkForTicket }).Clerk;
}

async function loadClerk(): Promise<ClerkForTicket> {
  const existing = clerkGlobal();
  if (existing?.loaded) return existing;

  const config = readClerkConfig();
  if (!config.configured) {
    throw new Error('Sign-in is not configured on this site. Please report this — it is not your password.');
  }

  if (!existing) {
    const { loadClerkJsScript } = await import('@clerk/shared/loadClerkJsScript');
    await loadClerkJsScript({ publishableKey: config.publishableKey });
  }
  const clerk = clerkGlobal();
  if (!clerk) throw new Error('Could not load the sign-in service. Check your connection and try again.');
  if (!clerk.loaded) await clerk.load();
  return clerk;
}

/**
 * `expectedProfileId` is the profile the sign-in response is for. Clerk refuses
 * a ticket sign-in on top of an existing session (`session_exists`), and a
 * returning visitor can reach here with one — see `existingClerkSession.ts`.
 * When that session is already this person's it is kept and the ticket is left
 * unspent (it expires on its own); when it is anyone else's, or cannot be shown
 * to be, it is ended first. With no session nothing changes.
 */
export async function redeemSignInTicket(ticket: string, expectedProfileId?: string): Promise<void> {
  const clerk = await loadClerk();
  if (!clerk.client) throw new Error('Could not start a secure session. Please try again.');

  const existing = decideExistingSession({
    hasActiveSession: Boolean(clerk.session),
    sessionExternalId: clerk.user?.externalId,
    expectedProfileId,
  });
  if (existing === 'reuse') return;
  // A callback replaces Clerk's default post-sign-out navigation, which would
  // otherwise reload the page in the middle of this sign-in.
  if (existing === 'replace') await clerk.signOut(() => undefined);

  const attempt = await clerk.client.signIn.create({ strategy: 'ticket', ticket });
  if (attempt.status !== 'complete' || !attempt.createdSessionId) {
    throw new Error('Could not start a secure session. Please sign in again.');
  }
  await clerk.setActive({ session: attempt.createdSessionId });
}
