/**
 * Load Clerk on demand, without mounting a provider (ADR-176 Phase 2.6).
 *
 * Two callers need this outside a `ClerkProvider`: redeeming a sign-in ticket
 * (`clerkTicket.ts`) and restoring a session on a shell that mounts no
 * provider — the tenant/Discover shell and the public pages (`AuthContext`).
 * `loadClerkJsScript` is the same loader `@clerk/clerk-react` uses, and it
 * publishes `window.Clerk` — so when a protected shell later mounts
 * `ClerkProvider`, the provider finds the already-loaded instance and reuses it
 * instead of starting a second one.
 *
 * Only ever reached through a dynamic `import()`, so the loader stays out of
 * the entry chunk.
 */
import { readClerkConfig } from './clerkConfig';

/** The bits of `window.Clerk` the ticket and restore paths touch. */
export interface ClerkInstance {
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

function clerkGlobal(): ClerkInstance | undefined {
  return (window as unknown as { Clerk?: ClerkInstance }).Clerk;
}

async function loadOnce(): Promise<ClerkInstance> {
  const config = readClerkConfig();
  if (!config.configured) {
    throw new Error('Sign-in is not configured on this site. Please report this — it is not your password.');
  }

  if (!clerkGlobal()) {
    const { loadClerkJsScript } = await import('@clerk/shared/loadClerkJsScript');
    await loadClerkJsScript({ publishableKey: config.publishableKey });
  }
  const clerk = clerkGlobal();
  if (!clerk) throw new Error('Could not load the sign-in service. Check your connection and try again.');
  if (!clerk.loaded) await clerk.load();
  return clerk;
}

/**
 * Only the in-flight load is shared: a sign-in and a session restore starting
 * together must not call `clerk.load()` twice. Once settled it is dropped, so
 * a failed load can be retried and an already-loaded instance is re-read.
 */
let inFlight: Promise<ClerkInstance> | null = null;

export async function loadClerk(): Promise<ClerkInstance> {
  const existing = clerkGlobal();
  if (existing?.loaded) return existing;
  if (!inFlight) inFlight = loadOnce().finally(() => { inFlight = null; });
  return inFlight;
}
