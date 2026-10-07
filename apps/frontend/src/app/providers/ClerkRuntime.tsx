import { useEffect, useMemo, type PropsWithChildren } from 'react';
import { ClerkProvider, useAuth as useClerkAuth } from '@clerk/clerk-react';
import type { ClerkSessionState } from '@lib/auth/sessionAuthority';
import { announceClerkSession } from '@lib/auth/clerkBrowser';
import { ClerkSessionContext } from './clerkSessionContext';

/**
 * Everything that touches `@clerk/clerk-react` at module scope.
 *
 * Split out from `ClerkAuthProvider` so it can be reached through a dynamic
 * `import()`, which puts the Clerk SDK in its own chunk instead of the entry
 * bundle. That matters because `/` is the public marketing page: importing
 * Clerk statically here added ~85 KB to the bundle every first-time visitor
 * downloads, in a phase where Clerk authenticates nobody. With this split the
 * chunk is fetched only when `VITE_CLERK_PUBLISHABLE_KEY` is set.
 */

/**
 * Clerk's `useAuth()` only works inside `ClerkProvider`, and React forbids
 * calling a hook conditionally — so components that must also work with Clerk
 * absent (route guards, the account button) cannot call it. This calls it in
 * the one place it is guaranteed valid and republishes the result through a
 * context whose default, `null`, is the "not configured" state that
 * `clerkPresence()` already understands.
 */
function ClerkSessionBridge({ children }: PropsWithChildren) {
  const { isLoaded, isSignedIn } = useClerkAuth();

  // `AuthProvider` sits above this and resolved its session before Clerk had
  // loaded; tell it to look again now that Clerk has an answer.
  useEffect(() => {
    if (isLoaded) announceClerkSession();
  }, [isLoaded, isSignedIn]);

  const value = useMemo<ClerkSessionState>(
    () => ({ isLoaded, isSignedIn: Boolean(isSignedIn) }),
    [isLoaded, isSignedIn],
  );

  return <ClerkSessionContext.Provider value={value}>{children}</ClerkSessionContext.Provider>;
}

export function ClerkRuntime({
  publishableKey,
  children,
}: PropsWithChildren<{ publishableKey: string }>) {
  return (
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      <ClerkSessionBridge>{children}</ClerkSessionBridge>
    </ClerkProvider>
  );
}
