import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@context/AuthContext';
import { StayoLoadingScreen } from '@shared/ui/brand';

interface ProtectedTenantRouteProps {
  children?: ReactNode;
}

export function ProtectedTenantRoute({ children }: ProtectedTenantRouteProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return <StayoLoadingScreen message="Signing you in…" />;
  }

  if (!user || user.role?.toLowerCase() !== 'tenant') {
    return <Navigate to="/" replace />;
  }

  if (!user.is_profile_completed) {
    return <Navigate to="/complete-profile" replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
