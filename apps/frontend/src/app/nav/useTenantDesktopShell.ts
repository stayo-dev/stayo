import { useAuth } from '@context/AuthContext';
import { useIsDesktop } from '@/app/components/ui/use-desktop';
import { tenancyState } from './useAppNav';
import { canOpenDashboard, type TenancyState } from './appNavConfig';

/**
 * Whether the desktop application shell (`AppConsoleShell` with the tenant
 * sidebar) should be mounted instead of the mobile bottom-nav layout.
 *
 * True only when **both**:
 *  - the viewport is `lg+` (`useIsDesktop()`, 1024px), and
 *  - the signed-in user has a dashboard to navigate — `canOpenDashboard`, i.e.
 *    tenancy state `LIVE` or `EXITING`. Those are exactly the people who have
 *    the five sidebar tabs (Home/Room/Food/Payments under `/tenant/*`, Profile).
 *
 * A signed-out visitor, an account with no tenancy, or an `EXITED` tenant keeps
 * the existing `AppBottomNav` layout at every width (they only ever had the
 * Profile tab anyway — see `buildOuterTabs`).
 *
 * `AppShell` and `TenantAppShell` both call this so their branch decisions
 * cannot drift.
 */
export function useTenantDesktopShell(): boolean {
  const isDesktop = useIsDesktop();
  const { user } = useAuth();
  return isDesktop && tenantHasDesktopShell(tenancyState(user));
}

/** Pure half, so the "which tenancy states get the shell" rule is testable. */
export function tenantHasDesktopShell(state: TenancyState): boolean {
  return canOpenDashboard(state);
}
