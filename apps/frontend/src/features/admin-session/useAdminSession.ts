import { useAuth } from '@context/AuthContext';

export interface AdminSession {
  adminId: string | undefined;
  name: string;
  email: string | undefined;
  isAuthenticated: boolean;
  isLoading: boolean;
}

/**
 * The platform-admin analog of `useTenantSession()`/`useOwnerSession()`.
 * Admits MANAGER sessions too (ADR-214) — `RequireAdminSession` is the real
 * gate; this only names the session for display.
 */
export function useAdminSession(): AdminSession {
  const { user, loading } = useAuth();
  const role = user?.role?.toLowerCase();
  return {
    adminId: user?.id,
    name: user?.name || 'Admin',
    email: user?.email,
    isAuthenticated: Boolean(user) && (role === 'admin' || role === 'manager'),
    isLoading: loading,
  };
}
