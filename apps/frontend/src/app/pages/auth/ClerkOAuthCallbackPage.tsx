import { AuthenticateWithRedirectCallback } from '@clerk/clerk-react';
import { ClerkAuthProvider } from '@/app/providers/ClerkAuthProvider';
import { StayoLoadingScreen } from '@shared/ui/brand';
import { readSsoCallbackDestination } from '@lib/auth/ssoCallbackDestination';

/**
 * `/sign-in/sso-callback` — completes the Google round trip started by
 * `clerk.client.signIn.authenticateWithRedirect()` in `ClerkGoogleButton.tsx`.
 *
 * **The bug this exists to fix.** That `redirectUrl` used to land on
 * `ClerkSignInPage`'s `<SignIn routing="path">`, on the theory that its own
 * sub-route handling would pick up `/sso-callback` and finish the attempt —
 * matching Clerk's convention for a fully Clerk-hosted flow, where `<SignIn>`
 * both starts and completes the sign-in. That is not this app's flow: Google
 * is started by `authenticateWithRedirect` called directly on
 * `clerk.client.signIn` (deliberately, so the button can be ours rather than
 * Clerk's own UI — see `ClerkGoogleButton.tsx`), and `<SignIn>` mounting fresh
 * at the callback URL had no in-progress attempt of its own to resume. Live
 * testing confirmed it: Google's redirect came back correctly, and the
 * callback rendered a brand new "sign in" prompt instead of finishing
 * anything. Even had it completed, `<SignIn fallbackRedirectUrl="/">` would
 * have sent everyone to the home page, bypassing `AuthCallbackPage`'s
 * account-linking rejection handling (`NO_STAYO_ACCOUNT`, `ACCOUNT_DISABLED`)
 * entirely.
 *
 * `<AuthenticateWithRedirectCallback>` is Clerk's own component for exactly
 * this pairing — completing an attempt started imperatively, regardless of
 * what UI started it.
 *
 * It does **not** read `redirectUrlComplete` back off the attempt (an earlier
 * version of this comment said it did — it was wrong, 2026-09-24): clerk-js
 * decides from this component's props alone. So the destination each caller
 * wants — `/auth/callback?flow=discover_signup` for Discover's sign-up tab,
 * `/lead-signup/callback` for `HostelLeadModal`, `/auth/callback` otherwise —
 * travels on this page's own URL (`ssoCallbackDestination.ts`) and is passed
 * as the *force* redirect for both outcomes, since a brand-new Google account
 * finishes here as a sign-up and a returning one as a sign-in.
 */
export function ClerkOAuthCallbackPage() {
  const destination = readSsoCallbackDestination(window.location.search);

  return (
    <ClerkAuthProvider>
      <StayoLoadingScreen message="Finishing sign-in…" />
      <AuthenticateWithRedirectCallback
        signInForceRedirectUrl={destination}
        signUpForceRedirectUrl={destination}
      />
    </ClerkAuthProvider>
  );
}
