import { useAuth } from '@context/AuthContext';
import { hasLiveTenancy } from '@/app/nav/useAppNav';

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
 *
 * `isAuthenticated` requires a *live* tenancy (`hasLiveTenancy`), not just
 * `role === 'tenant'` — a Discover-only marketplace account has that role
 * with no `tenants` row at all, and would otherwise fire tenancy-scoped
 * queries (`/tenants/me/profile`, `/tenants/me/documents`, …) that 404/empty
 * for it. This mirrors `ProtectedTenantRoute`'s gate, so `/tenant/*` pages
 * behave exactly as before (they already require live tenancy to be
 * reached at all) while hooks reused outside that guard — like the shared
 * Profile hub — stay safe for a seeker with no tenancy.
 */
export function useTenantSession(): TenantSession {
  const { user, loading } = useAuth();
  return {
    tenantId: user?.tenant_id,
    hostelId: user?.hostel_id,
    name: user?.name?.split(' ')[0] || 'there',
    isAuthenticated: hasLiveTenancy(user),
    isLoading: loading,
  };
}
