import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@context/AuthContext';
import { StayoLoadingScreen } from '@shared/ui/brand';

/**
 * UX-only: redirects a MANAGER session away from Super-Admin-only screens
 * (Managers, Activity) before it hits a wall of 403s from every query the
 * page fires. `RequireAdminSession` already gated the console itself; this
 * is a friendlier dead-end, not a security boundary — the underlying routes
 * (`/api/platform-admin/managers*`, `/api/platform-admin/activity`) reject a
 * manager session regardless of whether this component exists.
 */
export function RequireAdminOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <StayoLoadingScreen message="Loading…" />;
  if (user?.role?.toLowerCase() !== 'admin') return <Navigate to="/admin" replace />;
  return <>{children}</>;
}
