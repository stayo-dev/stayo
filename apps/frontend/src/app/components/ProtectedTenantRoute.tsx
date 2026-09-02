import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@context/AuthContext';
import { hasLiveTenancy, tenancyState } from '@/app/nav/useAppNav';
import { canOpenDashboard, hasFarewell } from '@/app/nav/appNavConfig';
import { StayoLoadingScreen } from '@shared/ui/brand';

interface ProtectedTenantRouteProps {
  children?: ReactNode;
}

export function ProtectedTenantRoute({ children }: ProtectedTenantRouteProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return <StayoLoadingScreen message="Signing you in…" />;
  }

  // See ProtectedRoute — `/` is an audience chooser since ADR-071, not a
  // place to land someone who was already using the app.
  if (!user || user.role?.toLowerCase() !== 'tenant') {
    return <Navigate to="/login" replace />;
  }

  /*
   * Three outcomes, not two.
   *
   * A TENANT role alone isn't enough. An account with no `tenants` row has
   * nothing to show inside the Dashboard and goes to the shared Profile hub;
   * the outer nav won't even offer a Dashboard tab for that state.
   *
   * A departed tenant used to fall through the same `hasLiveTenancy` check as
   * a no-tenancy account and get bounced with no message — so someone who
   * opened the app to check their refund landed elsewhere as though they had
   * never lived anywhere, and their settlement record became unreachable.
   * Worse, the bounce fired at `vacate`, a whole step before the money
   * settled.
   *
   * EXITING keeps the dashboard, read-only, until the settlement closes.
   * EXITED goes to the farewell screen, which explains what happened and
   * keeps the receipt. Only an account that never had a tenancy goes
   * straight to /profile. (ADR-122; fallback changed from /discover to
   * /profile in v1 — ADR-170.)
   */
  const state = tenancyState(user);
  if (!canOpenDashboard(state)) {
    return <Navigate to={hasFarewell(state) ? '/tenant/farewell' : '/profile'} replace />;
  }
  if (!hasLiveTenancy(user) && state !== 'EXITING') {
    return <Navigate to="/profile" replace />;
  }

  // Dashboard entry is no longer blocked on profile completeness — the
  // Dashboard shows a "Complete your profile" nudge card instead (see
  // ProfileCompletionNudge). `is_profile_completed` still exists and still
  // gates the separate invited-tenant onboarding wizard; it just isn't this
  // route's door anymore.

  return children ? <>{children}</> : <Outlet />;
}
