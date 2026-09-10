import { SignIn } from '@clerk/clerk-react';
import { ClerkAuthScreen } from './ClerkAuthScreen';

/**
 * `/sign-in` — Clerk-hosted sign-in, mounted in-app (ADR-176, Phase 2).
 *
 * `routing="path"` with `path="/sign-in"` is why the route is registered as
 * `/sign-in/*`: Clerk renders its own sub-steps (email code entry, SSO
 * callback, session tasks) as child paths, and without the splat they 404.
 *
 * **Which strategies appear here is Clerk Dashboard configuration, not code.**
 * `<SignIn>` renders whatever the instance allows, so "passwordless email OTP,
 * no passwords, no phone" is enforced by turning Email verification code *on*
 * and Password / Phone / Username *off* in the dashboard. Nothing in this file
 * can hold that invariant — see the Phase 2 section of ADR-176.
 *
 * Signing in here does **not** sign anyone into Stayo yet: no route reads the
 * Clerk session for authorisation (see `sessionAuthority.ts`), and the backend
 * still verifies Supabase tokens. That is Phase 3.
 */
export function ClerkSignInPage() {
  return (
    <ClerkAuthScreen title="Sign in">
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/" />
    </ClerkAuthScreen>
  );
}
