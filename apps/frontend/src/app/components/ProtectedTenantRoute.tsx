import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@context/AuthContext';
import { hasLiveTenancy } from '@/app/nav/useAppNav';
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

  // A TENANT role alone isn't enough — a Discover-only marketplace account
  // (no `tenants` row, e.g. someone who signed up to browse/enquire) has
  // nothing to show inside the Dashboard. Previously nothing checked this,
  // so such an account could reach `/tenant/*` as long as
  // `is_profile_completed` happened to be true. Send them to Explore instead
  // — the outer nav won't even offer a Dashboard tab for this state.
  if (!hasLiveTenancy(user)) {
    return <Navigate to="/discover" replace />;
  }

  // Dashboard entry is no longer blocked on profile completeness — the
  // Dashboard shows a "Complete your profile" nudge card instead (see
  // ProfileCompletionNudge). `is_profile_completed` still exists and still
  // gates the separate invited-tenant onboarding wizard; it just isn't this
  // route's door anymore.

  return children ? <>{children}</> : <Outlet />;
}
