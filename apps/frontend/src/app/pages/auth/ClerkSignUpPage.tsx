import { SignUp } from '@clerk/clerk-react';
import { ClerkAuthScreen } from './ClerkAuthScreen';

/**
 * `/sign-up` — Clerk-hosted sign-up, mounted in-app (ADR-176, Phase 2).
 *
 * Registered as `/sign-up/*` for the same reason as `/sign-in/*` — Clerk owns
 * the sub-paths of its own flow.
 *
 * Creating an account here creates a **Clerk** account. The `user.created`
 * webhook then writes a `users` row and links it to an existing `profiles` row
 * *by email if one exists* — it never creates a profile, so signing up here does
 * not provision a Stayo owner or tenant. That boundary is the point: business
 * roles stay in our database (ADR-176, [[Business-Rules]]).
 */
export function ClerkSignUpPage() {
  return (
    <ClerkAuthScreen title="Sign up">
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/" />
    </ClerkAuthScreen>
  );
}
