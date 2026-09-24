import { useEffect, useRef, type ReactNode } from 'react';
import { ClerkProvider, useClerk, useSignIn } from '@clerk/clerk-react';
import { readClerkConfig } from '@lib/auth/clerkConfig';
import { shouldSignOutBeforeGoogle } from '@lib/auth/existingClerkSession';
import { toAbsoluteUrl } from '@lib/auth/absoluteRedirectUrl';
import { buildSsoCallbackPath } from '@lib/auth/ssoCallbackDestination';

/**
 * The half of `<ClerkGoogleSignIn>` that touches the Clerk SDK, kept in its own
 * module so it can be reached by a dynamic `import()` and stay out of every
 * chunk that merely renders a login button (ADR-176 Phase 2.6/3).
 *
 * Starts the Google redirect as soon as it mounts: it is only ever mounted
 * because the user just clicked Google, so waiting for a second click would be
 * a worse flow than the one it replaces.
 *
 * `redirectUrl` is `/sign-in/sso-callback`, served by `ClerkOAuthCallbackPage`
 * (not `<SignIn>` — see that page's header comment). `redirectUrlComplete` is
 * where *this app* wants the person afterwards. **Both are made absolute**
 * (`toAbsoluteUrl`) before being handed to Clerk: Google's callback lands on
 * Clerk's own server, which is what resolves these into the final URL, and a
 * relative path resolves against Clerk's default domain (this app's Account
 * Portal, `accounts.yourstayo.com`) rather than `yourstayo.com` — confirmed
 * live (2026-09-23, [[Bugs]]) by a relative `redirectUrl` landing the whole
 * flow on the Account Portal, which then ran its own default sign-in/up UI
 * end to end, redirectUrlComplete discarded along with everything else this
 * app had configured.
 *
 * Reads Clerk through **both** hooks, each for what it alone gets right:
 * `useSignIn()`'s `isLoaded` purely for the effect's gate — it is reactive
 * (Clerk-react re-renders this component when it flips), which is what lets
 * the effect run a second time once the SDK finishes loading in the
 * background. `useClerk()`'s live instance for every actual call — this
 * component may sign out an existing session first (see below), and the
 * `signIn` resource `useSignIn()` hands back is a value captured at render
 * time; after an awaited `clerk.signOut()`, Clerk has replaced its `Client`,
 * and calling a method on the old resource is exactly the kind of staleness
 * bug `clerk.client.signIn`, read fresh at call time, avoids.
 *
 * Gating on `clerk.loaded` (from `useClerk()`) instead of `isLoaded` was tried
 * first and shipped a real regression: `clerk.loaded` is a plain property on
 * the singleton Clerk mutates in place, so reading it inside this effect only
 * sees its value at the moment the effect happens to run. The SDK loads
 * asynchronously, so that first run reliably saw `false`, returned, and
 * nothing ever gave the effect a second chance — `clerk` itself never changes
 * identity, so the dependency array never re-fires it. The button sat on
 * "Please wait…" forever: no request, no error, nothing to see anywhere.
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
  const { isLoaded } = useSignIn();
  const clerk = useClerk();
  const started = useRef(false);

  useEffect(() => {
    if (!isLoaded || started.current) return;
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

      // Thrown, not `?.`-swallowed: `isLoaded` true means the SignIn resource
      // is ready, so a missing `client` here is a real failure, and reporting
      // it is what lets `onFailed` below ever fire for it.
      if (!clerk.client) throw new Error('Clerk loaded with no client resource');

      const origin = window.location.origin;
      await clerk.client.signIn.authenticateWithRedirect({
        strategy: 'oauth_google',
        // The destination rides on the callback URL too: the callback cannot
        // read `redirectUrlComplete` back (see ssoCallbackDestination.ts), and a
        // brand-new Google account always finishes there.
        redirectUrl: toAbsoluteUrl(buildSsoCallbackPath(redirectUrlComplete), origin),
        redirectUrlComplete: toAbsoluteUrl(redirectUrlComplete, origin),
      });
    };

    run().catch((error: unknown) => {
      // Logged rather than swallowed: this exact failure mode — busy forever,
      // no network request, nothing in the console — is what made the bug
      // above invisible for as long as it was.
      console.error('[ClerkGoogleButton] could not start the Google redirect', error);
      // The redirect never happened, so this mount has nothing left to do.
      // `onFailed` un-arms the parent back to its idle "Continue with Google"
      // button — otherwise this component stays mounted showing "Please
      // wait…" forever, unclickable, with no way to retry short of reloading.
      onFailed();
    });
  }, [isLoaded, clerk, redirectUrlComplete, onFailed]);

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
