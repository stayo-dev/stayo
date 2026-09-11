import { usePushAutoRegister } from '@features/push/usePushAutoRegister';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Home, Users, Wallet, UtensilsCrossed, Building2 } from 'lucide-react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';
import { APP_GRID, APP_FRAME } from '@shared/ui/surface';
import { useIsDesktop } from '@/app/components/ui/use-desktop';
import { AppConsoleShell } from './AppConsoleShell';
import { isOwnerFullBleedPath } from './ownerShellRoutes';
import { buildOwnerNav } from '@/app/nav/ownerNav';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { HostelSwitcher } from '@features/owner-session/HostelSwitcher';
import { useMoreNav } from '@features/owner-more/hooks/useMoreNav';

/**
 * Owner app shell — bottom-nav chrome per BottomNav.dc.html: exactly 5 tabs
 * (Home / Tenants / Money / Food / Profile). The fifth tab was labelled
 * "Configure" while the screen it opens is the owner's own profile — their
 * details, password and payout account — so the tab and its destination now
 * call themselves the same thing. The route is unchanged (`/owner/more`). There is no "Alerts" tab in
 * the design — alerts are reached via the bell icon on Home instead; an
 * earlier pass of this file added a 6th "Alerts" tab that didn't match the
 * source, corrected here. `/owner/alerts` still exists as a route, just
 * unlinked from this nav. Desktop layout adaptation is flagged in the
 * foundation plan as a follow-up (Stayo App.dc.html has real desktop @media
 * rules not yet fully extracted) — this shell is mobile-first for now.
 *
 * `basePath` defaults to `/owner` — the single canonical owner app (real
 * `ProtectedRoute`-gated). A `/get-started/*` preview tree used to reuse this
 * shell with `basePath="/get-started"` while the StayO rebuild was mock-only;
 * that tree has since been migrated into `/owner/*` (see
 * `platforms/owner/router/OwnerRoutes.tsx`), so `basePath` is currently only
 * ever `/owner` — kept as a prop rather than hardcoded in case a second
 * mount point is ever needed again.
 *
 * Desktop (`lg`+, 1024px — [[Decisions#ADR-171|ADR-171]] Phase 1): this shell
 * mounts `AppConsoleShell` instead — the shared sidebar+topbar console, with
 * `buildOwnerNav()` (Home/Tenants/Money/Food/Hostels/Settings). Below `lg`
 * everything below is byte-for-byte unchanged: the 480px `APP_FRAME`, the
 * fixed bottom nav, its own `ThemeProvider`. The design source still has zero
 * `@media` rules; the desktop layout is net-new (see the plan), not extracted.
 */
function ownerTabs(basePath: string) {
  return [
    { to: `${basePath}/home`, label: 'Home', icon: Home },
    { to: `${basePath}/tenants`, label: 'Tenants', icon: Users },
    { to: `${basePath}/money`, label: 'Money', icon: Wallet },
    { to: `${basePath}/food`, label: 'Food', icon: UtensilsCrossed },
    { to: `${basePath}/hostels`, label: 'Hostels', icon: Building2 },
  ];
}

interface OwnerAppShellProps {
  basePath?: string;
}

export function OwnerAppShell({ basePath = '/owner' }: OwnerAppShellProps) {
  // Before any layout branch, so it runs on every signed-in owner screen.
  usePushAutoRegister();
  const isDesktop = useIsDesktop();
  const { pathname } = useLocation();
  const session = useOwnerSession();
  const { signOut } = useMoreNav();
  const tabs = ownerTabs(basePath);

  // Desktop (lg+): the shared console shell — sidebar + topbar. It provides its
  // own <ThemeProvider theme="product"> and grid ground, so the 480px frame is
  // simply not applied and the page fills the content area. The sidebar's
  // `contextSlot` carries the `HostelSwitcher` (ADR-171 §6, Phase 2.6) — the
  // one owner hostel-context control, backed by the existing `useSelectedHostel`
  // state. Owner takeover routes still declared outside this component in
  // OwnerRoutes.tsx (Hostel drilldown, most work queues, builder) are untouched.
  if (isDesktop) {
    return (
      <AppConsoleShell
        nav={buildOwnerNav()}
        contextSlot={session.hostels.length > 0 ? <HostelSwitcher /> : undefined}
        identity={{ name: session.ownerName ?? 'Owner', sublabel: 'Owner' }}
        onSignOut={signOut}
      >
        <Outlet />
      </AppConsoleShell>
    );
  }

  // Mobile full-screen takeover routes that are now nested *inside* this shell
  // (Phase 2.1: the Tenant Detail pane, `/owner/tenants/:tenantId`, nested under
  // `/owner/tenants` so <MasterDetail> can render it) must still render with no
  // bottom nav / no 480px frame — byte-equivalent to when they were declared
  // outside OwnerAppShell. `TenantDetailPage` brings its own ThemeProvider +
  // APP_SURFACE; this is just the theme scope + error boundary around it.
  if (isOwnerFullBleedPath(pathname)) {
    return (
      <ThemeProvider theme="product">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme="product">
      <div className={`flex min-h-screen flex-col bg-background text-foreground ${APP_GRID} ${APP_FRAME}`}>
        <main className="flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-4px_16px_rgba(40,30,20,0.03)] sm:inset-x-auto sm:left-1/2 sm:w-[480px] sm:-translate-x-1/2">
          <div className="mx-auto grid max-w-3xl grid-cols-5">
            {tabs.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className="flex flex-col items-center gap-[5px] py-2.5 text-[10.5px] tracking-[0.01em]"
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`flex h-6.5 w-11 items-center justify-center rounded-full ${
                        isActive ? 'bg-primary/10' : ''
                      }`}
                    >
                      <Icon
                        className="h-[23px] w-[23px]"
                        strokeWidth={isActive ? 2.5 : 1.6}
                        color={isActive ? 'var(--primary)' : '#988D82'}
                      />
                    </span>
                    <span
                      className={isActive ? 'font-bold text-primary' : 'font-medium'}
                      style={!isActive ? { color: '#988D82' } : undefined}
                    >
                      {label}
                    </span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </ThemeProvider>
  );
}
