import { useEffect, useRef, type ReactNode } from 'react';
import { ClerkProvider, useSignIn } from '@clerk/clerk-react';
import { readClerkConfig } from '@lib/auth/clerkConfig';

/**
 * The half of `<ClerkGoogleSignIn>` that touches the Clerk SDK, kept in its own
 * module so it can be reached by a dynamic `import()` and stay out of every
 * chunk that merely renders a login button (ADR-176 Phase 2.6/3).
 *
 * Starts the Google redirect as soon as it mounts: it is only ever mounted
 * because the user just clicked Google, so waiting for a second click would be
 * a worse flow than the one it replaces.
 *
 * `redirectUrl` is Clerk's own SSO landing route (`/sign-in/sso-callback`,
 * served by `<SignIn routing="path" path="/sign-in">`), which completes the
 * handshake and transfers to sign-up when the Google email is new to Clerk.
 * `redirectUrlComplete` is where *this app* wants the person afterwards.
 */
function ClerkGoogleRedirect({
  redirectUrlComplete,
  children,
}: {
  redirectUrlComplete: string;
  children: (state: { disabled: boolean; onClick: () => void; busy: boolean }) => ReactNode;
}) {
  const { signIn, isLoaded } = useSignIn();
  const started = useRef(false);

  useEffect(() => {
    if (!isLoaded || started.current) return;
    started.current = true;

    signIn
      ?.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: '/sign-in/sso-callback',
        redirectUrlComplete,
      })
      .catch(() => {
        // Leaving `started` set: a failed redirect that re-armed itself would
        // loop. The button returns to its idle state and the person can retry.
        started.current = false;
      });
  }, [isLoaded, signIn, redirectUrlComplete]);

  return <>{children({ disabled: true, onClick: () => {}, busy: true })}</>;
}

/**
 * Mounts `ClerkProvider` directly rather than reusing `app/providers/
 * ClerkAuthProvider`, because `scripts/check-architecture.mjs` keeps
 * `src/shared` a leaf — it may not import from `app/`. That is the right rule
 * here: this module is reached from `LoginModal`, which sits in the entry
 * chunk, and the import would have dragged the provider onto the landing
 * page's critical path as well as breaking the boundary.
 *
 * Safe to mount a second provider: this one exists only for the moment between
 * the click and the redirect away. It is also the reason `window.Clerk` becomes
 * available to `api-client`/`AuthContext`, which read the session through the
 * global rather than through React context.
 *
 * Still behind this module's dynamic `import()`, so no Clerk code loads until
 * someone actually reaches for Google.
 */
export function ClerkGoogleButton(props: {
  redirectUrlComplete: string;
  children: (state: { disabled: boolean; onClick: () => void; busy: boolean }) => ReactNode;
}) {
  const config = readClerkConfig();
  if (!config.configured) {
    return <>{props.children({ disabled: true, onClick: () => {}, busy: false })}</>;
  }

  return (
    <ClerkProvider publishableKey={config.publishableKey} afterSignOutUrl="/">
      <ClerkGoogleRedirect {...props} />
    </ClerkProvider>
  );
}
