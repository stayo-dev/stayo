import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@context/AuthContext';
import { StayoLoadingScreen } from '@shared/ui/brand';
import { useClerkSessionState } from '@/app/providers/clerkSessionContext';
import { decideRouteAccess, shouldExplainUnlinkedClerkSession } from '@lib/auth/sessionAuthority';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

/**
 * The decision itself lives in `lib/auth/sessionAuthority.ts` so it can be
 * tested without a DOM (this app's suite is node-only), and so the rule that
 * matters during the Clerk migration is stated in one place: **a Clerk session
 * authorises nothing on its own.** Roles come from `profiles` via `AuthContext`,
 * which is still Supabase-backed; `sessionAuthority.test.ts` proves that
 * varying the Clerk state changes no decision here (ADR-176, Phase 2).
 */
export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const clerk = useClerkSessionState();
  const location = useLocation();

  const decision = decideRouteAccess({
    profileLoading: loading,
    profile: user ? { role: user.role } : null,
    clerk,
    allowedRoles,
  });

  if (decision === 'loading') {
    return <StayoLoadingScreen message="Signing you in…" />;
  }

  // `/login` rather than `/`: since ADR-071 the root is an audience chooser,
  // and asking someone whose session just expired whether they're a student
  // or an owner — instead of letting them sign back in — loses the thread.
  if (decision === 'redirect-login') {
    // Signed into Clerk but unknown to Stayo: a real state in Phase 2, since
    // nothing reads `users.clerk_user_id` on a request path yet. Carried as
    // route state so `/login` can say so instead of looking like a failure.
    const unlinkedClerkSession = shouldExplainUnlinkedClerkSession({
      profileLoading: loading,
      profile: user ? { role: user.role } : null,
      clerk,
    });

    return <Navigate to="/login" state={{ from: location, unlinkedClerkSession }} replace />;
  }

  // Signed in, but not for this. Unlike the no-session case above, `/` is
  // right here: we can't guess which surface they *do* belong on, and the
  // chooser is exactly the screen for that question.
  if (decision === 'redirect-home') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
