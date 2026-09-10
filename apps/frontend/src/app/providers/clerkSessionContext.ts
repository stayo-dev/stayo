import { createContext, useContext } from 'react';
import type { ClerkSessionState } from '@lib/auth/sessionAuthority';

/**
 * The Clerk session, republished into our own context.
 *
 * In its own module, importing **nothing from `@clerk/clerk-react`**, and that
 * is the whole point. `ClerkAuthProvider` and `ProtectedRoute` need this hook
 * on every render; `ClerkRuntime` needs the Provider. If the two lived
 * together, the guard's static import would drag the Clerk SDK into the entry
 * bundle and quietly defeat the `lazy()` that is supposed to keep it out.
 *
 * The default of `null` is the "Clerk not configured" state that
 * `clerkPresence()` already understands.
 *
 * Import the hook from HERE, never re-exported from `ClerkAuthProvider`:
 * a re-export is a static edge into the module that owns the `lazy()`, and
 * `ProtectedRoute` importing it that way silently pulled `clerkConfig` and the
 * ClerkRuntime dynamic import back into the entry chunk (ADR-176 Phase 2.6).
 */
export const ClerkSessionContext = createContext<ClerkSessionState | null>(null);

export function useClerkSessionState(): ClerkSessionState | null {
  return useContext(ClerkSessionContext);
}
