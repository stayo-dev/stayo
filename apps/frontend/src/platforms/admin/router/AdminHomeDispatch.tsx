import type { ReactNode } from 'react';
import { useAuth } from '@context/AuthContext';
import { StayoLoadingScreen } from '@shared/ui/brand';

/**
 * `/admin` renders a different landing page per role (spec §6) — this is
 * purely which component mounts, not an authorization decision. Both
 * `admin`/`manager` sessions already passed `RequireAdminSession`; the real
 * gate on what each page's own data queries return is server-side.
 */
export function AdminHomeDispatch({ admin, manager }: { admin: ReactNode; manager: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <StayoLoadingScreen message="Loading…" />;
  return user?.role?.toLowerCase() === 'manager' ? <>{manager}</> : <>{admin}</>;
}
