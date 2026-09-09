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
 */
export const ClerkSessionContext = createContext<ClerkSessionState | null>(null);

export function useClerkSessionContext(): ClerkSessionState | null {
  return useContext(ClerkSessionContext);
}
