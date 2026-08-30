import { Link, Outlet } from 'react-router-dom';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';
import { useAppNav } from '@/app/nav/useAppNav';
import { APP_GRID, APP_FRAME } from '@shared/ui/surface';

/**
 * The Tenant Dashboard's content wrapper — background/frame chrome only, no
 * nav of its own. Previously owned a second, inner tab strip
 * (Home/Money/Room/Food/Complaints, below the outer Explore/Dashboard/
 * Profile bar); that split is retired in favour of one single-level nav —
 * `AppShell`'s `AppBottomNav` now renders all six tabs (Home/Payments/Food/
 * Room/Profile/Explore, see `ACTIVE_TENANT_TABS`) directly, so there is no
 * second nav layer to stack beneath it.
 *
 * Desktop: same treatment as `OwnerAppShell` — `Stayo Tenant.dc.html` has no
 * `@media`/desktop rules (fixed 402x874 mobile device-frame mockup), so on
 * `sm:`+ viewports this centers the same mobile layout in a bordered 480px
 * frame rather than inventing a new breakpoint.
 */
export function TenantAppShell() {
  return (
    <ThemeProvider theme="product">
      <div className={`flex min-h-screen flex-col bg-background text-foreground ${APP_GRID} ${APP_FRAME}`}>
        <ExitingBanner />
        <main className="flex-1">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </ThemeProvider>
  );
}

/**
 * Shown to a tenant whose move-out has started but whose settlement is still
 * open (`tenancy_state === 'EXITING'`).
 *
 * The dashboard used to disappear the moment the bed was released — a whole
 * step before the money settled — so the person with a refund outstanding
 * lost the only screen that showed it, silently. They keep it now, read-only,
 * and this says so rather than leaving them to discover it by tapping things
 * that no longer work. (ADR-122)
 */
function ExitingBanner() {
  const { dashboardReadOnly } = useAppNav();
  if (!dashboardReadOnly) return null;

  return (
    <div className="border-b border-border bg-secondary/40 px-4 py-2.5">
      <p className="text-[12px] leading-snug text-foreground">
        <span className="font-bold">You’ve moved out.</span>{' '}
        Your pages are read-only while the final settlement is finished.{' '}
        <Link to="/tenant/farewell" className="font-semibold underline underline-offset-2">
          See your settlement
        </Link>
      </p>
    </div>
  );
}
