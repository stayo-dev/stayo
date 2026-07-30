import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@context/AuthContext';

interface RequireAdminSessionProps {
  children?: ReactNode;
}

/** Mirrors `ProtectedTenantRoute` — no public admin signup, so there is no "complete profile" redirect branch. */
export function RequireAdminSession({ children }: RequireAdminSessionProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (!user || user.role?.toLowerCase() !== 'admin') {
    return <Navigate to="/login" replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
