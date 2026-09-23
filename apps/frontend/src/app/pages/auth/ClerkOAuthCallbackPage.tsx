import { AuthenticateWithRedirectCallback } from '@clerk/clerk-react';
import { ClerkAuthProvider } from '@/app/providers/ClerkAuthProvider';
import { StayoLoadingScreen } from '@shared/ui/brand';

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
 * what UI started it. It reads `redirectUrlComplete` back off the attempt
 * itself (the value each caller already passed to `authenticateWithRedirect`
 * — `/auth/callback` by default, `/lead-signup/callback` for
 * `HostelLeadModal`), so every caller lands where it always meant to; the
 * `*FallbackRedirectUrl` props below are only the default for an attempt that
 * somehow didn't specify one.
 */
export function ClerkOAuthCallbackPage() {
  return (
    <ClerkAuthProvider>
      <StayoLoadingScreen message="Finishing sign-in…" />
      <AuthenticateWithRedirectCallback
        signInFallbackRedirectUrl="/auth/callback"
        signUpFallbackRedirectUrl="/auth/callback"
      />
    </ClerkAuthProvider>
  );
}
