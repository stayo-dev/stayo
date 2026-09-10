import type { ReactNode } from 'react';
import { useAuth } from '@context/AuthContext';
import { AppBottomNav } from '@/app/components/AppBottomNav';
import { NavAnchorProvider } from '@/app/nav/NavAnchorContext';
import { GRID_GROUND } from '@/app/pages/discover/discoverTheme';
import { useTenantDesktopShell } from '@/app/nav/useTenantDesktopShell';
import { AppConsoleShell } from './AppConsoleShell';
import { buildTenantNav } from '@/app/nav/tenantNav';

/**
 * The one outer shell for every surface reachable from the app-wide bottom
 * nav — the shared Profile hub (`/profile/*`) and, nested one level deeper,
 * the Tenant Dashboard (`/tenant/*`). Mounted by `SeekerAppShell`, which owns
 * the `AuthProvider` this reads.
 *
 * **Below `lg` (1024px):** exactly as before — `AppBottomNav` at the bottom, the
 * Discover graph-paper ground, no chrome of its own (`TenantAppShell` nests
 * inside for the four dashboard tabs).
 *
 * **At `lg`+ for a signed-in tenant with a live/exiting dashboard**
 * (`useTenantDesktopShell`): the shared `AppConsoleShell` (sidebar + topbar,
 * `buildTenantNav`) replaces the bottom nav. This is the single integration
 * point that covers *both* `/tenant/*` and `/profile/*` — `/profile` is a
 * sibling route of `/tenant/*` under `SeekerAppShell`, not a child, so wiring
 * the console here (rather than in `TenantAppShell`) is what lets the Profile
 * sidebar tab render with the same shell as the other four without touching the
 * route tree. Signed-out / no-tenancy / exited users keep `AppBottomNav` at
 * every width. `AppBottomNav.tsx` itself is unchanged.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const showConsole = useTenantDesktopShell();
  const { user, logout } = useAuth();

  if (showConsole) {
    return (
      <NavAnchorProvider>
        <AppConsoleShell
          nav={buildTenantNav()}
          identity={{ name: user?.name ?? 'Your account', sublabel: user?.email ?? undefined }}
          onSignOut={() => logout()}
        >
          {children}
        </AppConsoleShell>
      </NavAnchorProvider>
    );
  }

  return (
    <NavAnchorProvider>
      <div className="flex min-h-[100dvh] flex-col antialiased" style={GRID_GROUND}>
        <div className="flex-1 pb-[env(safe-area-inset-bottom)]">{children}</div>
        <AppBottomNav />
      </div>
    </NavAnchorProvider>
  );
}
