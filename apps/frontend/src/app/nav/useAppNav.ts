import { useAuth } from '@context/AuthContext';
import {
  LIVE_TENANCY_STATUSES,
  buildOuterTabs,
  canOpenDashboard,
  isDashboardReadOnly,
  type AppNavTab,
  type TenancyState,
} from './appNavConfig';

/**
 * Single source of truth for "does this signed-in user have a live tenancy"
 * — same definition the backend already uses in
 * `profile-identity-service.ts` (`INVITED`/`ACTIVE`), reused here rather than
 * re-derived, so the frontend and backend never disagree on what "live" means.
 */
export function hasLiveTenancy(user: { tenant_status?: string | null } | null | undefined): boolean {
  return !!user?.tenant_status && LIVE_TENANCY_STATUSES.has(user.tenant_status);
}

/**
 * Where this person stands with their tenancy.
 *
 * The backend computes it in `/api/auth/me` because only it knows whether an
 * unsettled move-out exists. The fallback derives what it can from
 * `tenant_status` alone, for a session hydrated before this field shipped.
 */
export function tenancyState(
  user: { tenant_status?: string | null; tenancy_state?: string | null } | null | undefined,
): TenancyState {
  const given = user?.tenancy_state;
  if (given === 'LIVE' || given === 'EXITING' || given === 'EXITED' || given === 'NONE') return given;
  if (!user?.tenant_status) return 'NONE';
  return LIVE_TENANCY_STATUSES.has(user.tenant_status) ? 'LIVE' : 'EXITED';
}

export function useAppNav(): {
  outerTabs: AppNavTab[];
  liveTenancy: boolean;
  tenancyState: TenancyState;
  dashboardReadOnly: boolean;
} {
  const { user } = useAuth();
  const liveTenancy = hasLiveTenancy(user);
  const state = tenancyState(user);
  return {
    outerTabs: buildOuterTabs({ signedIn: Boolean(user), liveTenancy, tenancyState: state }),
    liveTenancy,
    tenancyState: state,
    dashboardReadOnly: isDashboardReadOnly(state),
  };
}

export { canOpenDashboard };
