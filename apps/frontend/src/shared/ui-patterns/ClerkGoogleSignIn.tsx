import { Suspense, lazy, useState, type ReactNode } from 'react';
import { readClerkConfig } from '@lib/auth/clerkConfig';

/**
 * "Continue with Google", via Clerk (ADR-176 Phase 3).
 *
 * Replaces `supabase.auth.signInWithOAuth({ provider: 'google' })`. Google is
 * Clerk's now; Supabase must never be re-entered for it.
 *
 * **Why a component and not an `AuthContext` method.** Clerk's `useSignIn()`
 * only works inside a `ClerkProvider`, and `AuthProvider` is mounted above one
 * on every shell. Rather than invert that nesting — which would put the Clerk
 * SDK on the public landing page and undo Phase 2.6 — this mounts its own
 * `ClerkAuthProvider`. Because that provider loads the SDK through a dynamic
 * import, `/` still ships no Clerk until a login surface actually renders.
 *
 * `authenticateWithRedirect` rather than Clerk's prebuilt `<SignIn>`: the
 * button has to be one click from wherever it already sits, and it keeps this
 * app's own layout and copy. Clerk's SSO callback route handles the rest,
 * including the sign-in ⇄ sign-up transfer for an email it has not seen.
 */

const ClerkGoogleButton = lazy(() =>
  import('./ClerkGoogleButton').then((m) => ({ default: m.ClerkGoogleButton })),
);

export interface ClerkGoogleSignInProps {
  /** Where to land once Clerk has a session. Defaults to the shared callback. */
  redirectUrlComplete?: string;
  /** Rendered while the Clerk chunk loads, and when Clerk is unconfigured. */
  children: (state: { disabled: boolean; onClick: () => void; busy: boolean }) => ReactNode;
}

export function ClerkGoogleSignIn({
  redirectUrlComplete = '/auth/callback',
  children,
}: ClerkGoogleSignInProps) {
  const [armed, setArmed] = useState(false);
  const config = readClerkConfig();

  // Unconfigured is a supported state (Phase 2): render the caller's button
  // disabled rather than crashing a login screen that still works by password.
  if (!config.configured) {
    return <>{children({ disabled: true, onClick: () => setArmed(false), busy: false })}</>;
  }

  // The SDK is only fetched once someone actually reaches for Google.
  if (!armed) {
    return <>{children({ disabled: false, onClick: () => setArmed(true), busy: false })}</>;
  }

  return (
    <Suspense fallback={<>{children({ disabled: true, onClick: () => {}, busy: true })}</>}>
      <ClerkGoogleButton redirectUrlComplete={redirectUrlComplete}>{children}</ClerkGoogleButton>
    </Suspense>
  );
}
