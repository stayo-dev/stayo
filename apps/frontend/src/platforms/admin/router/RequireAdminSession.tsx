import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@context/AuthContext';
import { StayoLoadingScreen } from '@shared/ui/brand';

interface RequireAdminSessionProps {
  children?: ReactNode;
}

/**
 * Mirrors `ProtectedTenantRoute` — no public admin signup, so there is no
 * "complete profile" redirect branch.
 *
 * Admits both ADMIN (unrestricted) and MANAGER (scoped) sessions into the
 * console shell — this is only the front door. Which nav items/pages/tabs a
 * manager actually sees is a UX-only filter (`useAdminPermissions`); the real
 * gate is server-side on every route the console calls
 * (`requireAdminOrManagerPermission`/`assertHostelAccess`), so a manager
 * session reaching this component grants no data access by itself.
 */
export function RequireAdminSession({ children }: RequireAdminSessionProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return <StayoLoadingScreen message="Signing you in…" />;
  }

  const role = user?.role?.toLowerCase();
  if (!user || (role !== 'admin' && role !== 'manager')) {
    return <Navigate to="/login" replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
