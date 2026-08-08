import { useMockOwnerJourney } from '@features/owner-onboarding/context/MockOwnerJourneyContext';
import { useAuth } from '@context/AuthContext';

/**
 * Owner sign-out.
 *
 * This used to call `journey.reset()` and `navigate('/')` and nothing else —
 * no server call, no Supabase sign-out, no session revocation. It *looked*
 * correct, because landing on the marketing page is exactly what a real
 * sign-out does. But the Supabase session survived in storage, so returning
 * to `/login` re-hydrated the user from `GET /auth/me` and `AuthContext`'s
 * redirect effect sent the "signed-out" owner straight back into
 * `/owner/home`. On a shared computer the next person had the dashboard.
 *
 * `logout()` is the only thing that actually ends a session: it posts to
 * `/api/auth/logout` (Postgres revocation + the Redis deny-list that
 * `middleware.ts` checks on every later request, plus Supabase's own
 * refresh-token revocation), signs out the Supabase client, clears the query
 * cache and session-scoped storage, and redirects. Enforced for every
 * sign-out control by `src/context/logoutIntegrity.test.ts`.
 */
export function useMoreNav() {
  const journey = useMockOwnerJourney();
  const { logout } = useAuth();

  const signOut = async () => {
    // Clears the in-memory copy. The persisted copy lives in sessionStorage,
    // which `logout()`'s own storage teardown already wipes.
    journey.reset();
    await logout();
  };

  return { signOut };
}
