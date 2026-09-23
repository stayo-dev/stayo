import { useEffect, useRef, type ReactNode } from 'react';
import { ClerkProvider, useClerk } from '@clerk/clerk-react';
import { readClerkConfig } from '@lib/auth/clerkConfig';
import { shouldSignOutBeforeGoogle } from '@lib/auth/existingClerkSession';

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
 *
 * Reads Clerk through `useClerk()` rather than `useSignIn()`: this component
 * may sign out an existing session first (see below), and the `signIn`
 * resource `useSignIn()` hands back is a value captured at render time — after
 * an awaited call to `clerk.signOut()`, Clerk has replaced its `Client`, and calling a method
 * on the old resource is exactly the kind of staleness bug that class of hook
 * exists to prevent. `clerk.client.signIn` is a live property read instead,
 * always current at the point it's called.
 */
function ClerkGoogleRedirect({
  redirectUrlComplete,
  children,
  onFailed,
}: {
  redirectUrlComplete: string;
  children: (state: { disabled: boolean; onClick: () => void; busy: boolean }) => ReactNode;
  /** Called once the redirect could not be started. The caller un-arms back to idle so the person can retry. */
  onFailed: () => void;
}) {
  const clerk = useClerk();
  const started = useRef(false);

  useEffect(() => {
    if (!clerk.loaded || started.current) return;
    started.current = true;

    const run = async () => {
      // Clerk refuses a new sign-in outright while this browser already holds
      // one (`session_exists`) — reachable here because the public shell can
      // reach the login modal without ever having loaded Clerk, so a session
      // left over from an earlier sign-in survives unnoticed. Who this Google
      // sign-in is *for* isn't known until it completes, so unlike the ticket
      // flow there is no same-person check to make first — any existing
      // session is ended.
      if (shouldSignOutBeforeGoogle(Boolean(clerk.session))) {
        // A callback suppresses Clerk's default post-sign-out navigation,
        // which would otherwise race the redirect this function is about to
        // start.
        await clerk.signOut(() => undefined);
      }

      await clerk.client?.signIn.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: '/sign-in/sso-callback',
        redirectUrlComplete,
      });
    };

    run().catch(() => {
      // The redirect never happened, so this mount has nothing left to do.
      // `onFailed` un-arms the parent back to its idle "Continue with Google"
      // button — otherwise this component stays mounted showing "Please
      // wait…" forever, unclickable, with no way to retry short of reloading.
      onFailed();
    });
  }, [clerk, redirectUrlComplete, onFailed]);

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
  onFailed: () => void;
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
