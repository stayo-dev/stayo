import { useAuth } from '@context/AuthContext';

export interface AdminSession {
  adminId: string | undefined;
  name: string;
  email: string | undefined;
  isAuthenticated: boolean;
  isLoading: boolean;
}

/** The platform-admin analog of `useTenantSession()`/`useOwnerSession()`. */
export function useAdminSession(): AdminSession {
  const { user, loading } = useAuth();
  return {
    adminId: user?.id,
    name: user?.name || 'Admin',
    email: user?.email,
    isAuthenticated: Boolean(user) && user?.role?.toLowerCase() === 'admin',
    isLoading: loading,
  };
}
