import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@context/AuthContext';
import { StayoLoadingScreen } from '@shared/ui/brand';

interface RequireAdminSessionProps {
  children?: ReactNode;
}

/** Mirrors `ProtectedTenantRoute` — no public admin signup, so there is no "complete profile" redirect branch. */
export function RequireAdminSession({ children }: RequireAdminSessionProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return <StayoLoadingScreen message="Signing you in…" />;
  }

  if (!user || user.role?.toLowerCase() !== 'admin') {
    return <Navigate to="/login" replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
