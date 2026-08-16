import { useAuth } from '@context/AuthContext';
import { ACTIVE_TENANT_TABS, EXPLORE_PROFILE_TABS, LIVE_TENANCY_STATUSES, type AppNavTab } from './appNavConfig';

/**
 * Single source of truth for "does this signed-in user have a live tenancy"
 * — same definition the backend already uses in
 * `profile-identity-service.ts` (`INVITED`/`ACTIVE`), reused here rather than
 * re-derived, so the frontend and backend never disagree on what "live" means.
 */
export function hasLiveTenancy(user: { tenant_status?: string | null } | null | undefined): boolean {
  return !!user?.tenant_status && LIVE_TENANCY_STATUSES.has(user.tenant_status);
}

export function useAppNav(): { outerTabs: AppNavTab[]; liveTenancy: boolean } {
  const { user } = useAuth();
  const liveTenancy = hasLiveTenancy(user);
  return {
    outerTabs: liveTenancy ? ACTIVE_TENANT_TABS : EXPLORE_PROFILE_TABS,
    liveTenancy,
  };
}
