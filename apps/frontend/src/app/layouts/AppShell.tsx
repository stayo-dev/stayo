import type { ReactNode } from 'react';
import { AppBottomNav } from '@/app/components/AppBottomNav';
import { NavAnchorProvider } from '@/app/nav/NavAnchorContext';
import { GRID_GROUND } from '@/app/pages/discover/discoverTheme';

/**
 * The one outer shell for every surface reachable from the app-wide bottom
 * nav — Explore, the shared Profile hub, and (nested one level deeper) the
 * Tenant Dashboard. Mounted inside both the Discover/Explore provider shell
 * and the Tenant provider shell, each of which already establishes its own
 * `AuthProvider` — `AppShell` itself is stateless chrome, `useAppNav` (read
 * inside `AppBottomNav`) does the state-dependent work.
 *
 * Replaces `DiscoverShell`'s nav-owning role; `TenantAppShell` nests *inside*
 * this (as the Dashboard-only inner tab strip) rather than owning its own
 * fixed-bottom bar, so the two nav layers never stack.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <NavAnchorProvider>
      <div className="flex min-h-[100dvh] flex-col antialiased" style={GRID_GROUND}>
        <div className="flex-1 pb-[env(safe-area-inset-bottom)]">{children}</div>
        <AppBottomNav />
      </div>
    </NavAnchorProvider>
  );
}
