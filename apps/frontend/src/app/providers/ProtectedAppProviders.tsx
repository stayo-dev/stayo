import { useMemo, type PropsWithChildren } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider } from '@context/AuthContext';
import { queryClient } from '@lib/queryClient';
import { ClerkAuthProvider } from '@/app/providers/ClerkAuthProvider';
import { readClerkConfig } from '@lib/auth/clerkConfig';

/**
 * The providers every authenticated tree shares — owner, admin, and (via
 * `SeekerAppShell`) tenant.
 *
 * Clerk is mounted **here** rather than in `RootProviders` (ADR-176 Phase 2.6).
 * Mounting it globally meant the public marketing page at `/` suspended on the
 * Clerk chunk before the router could even render its own route chunk — two
 * serialised fetches on the one page that must be fastest. Everything below
 * this point is already behind a lazy shell and a signed-in session, so the
 * SDK is paid for by people who have a reason to load it.
 *
 * It still no-ops entirely when `VITE_CLERK_PUBLISHABLE_KEY` is unset.
 */
export function ProtectedAppProviders({ children }: PropsWithChildren) {
  // Clerk mounts below AuthProvider, so AuthProvider must wait for it rather
  // than call a cold load "signed out" (and bounce the owner to /login).
  const clerkConfigured = useMemo(() => readClerkConfig().configured, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider awaitClerk={clerkConfigured}>
        <ClerkAuthProvider>{children}</ClerkAuthProvider>
        <Toaster position="top-right" expand visibleToasts={4} closeButton richColors />
      </AuthProvider>
    </QueryClientProvider>
  );
}

