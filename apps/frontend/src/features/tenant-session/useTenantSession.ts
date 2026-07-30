import { useAuth } from '@context/AuthContext';

export interface TenantSession {
  tenantId: string | undefined;
  hostelId: string | undefined;
  name: string;
  isAuthenticated: boolean;
  isLoading: boolean;
}

/**
 * The tenant-side analog of `useOwnerSession()` — the one hook tenant-facing
 * real-data hooks should call for "who is logged in." Most tenant-facing API
 * routes derive `tenant_id`/`hostel_id` themselves from the session (via
 * `profile_id`), so this is mainly for display and `enabled:` gating, not
 * for passing ids into requests.
 */
export function useTenantSession(): TenantSession {
  const { user, loading } = useAuth();
  return {
    tenantId: user?.tenant_id,
    hostelId: user?.hostel_id,
    name: user?.name?.split(' ')[0] || 'there',
    isAuthenticated: Boolean(user) && user?.role?.toLowerCase() === 'tenant',
    isLoading: loading,
  };
}
