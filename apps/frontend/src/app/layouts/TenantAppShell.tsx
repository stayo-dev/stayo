import { usePushAutoRegister } from '@features/push/usePushAutoRegister';
import { Link, Outlet } from 'react-router-dom';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';
import { useAppNav } from '@/app/nav/useAppNav';
import { useTenantDesktopShell } from '@/app/nav/useTenantDesktopShell';
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
 * Desktop (`lg`+, 1024px — [[Decisions#ADR-171|ADR-171]] Phase 1): `AppShell`
 * (one level up) has already mounted `AppConsoleShell`, which owns the
 * `ThemeProvider`, the grid ground and the scrolling `<main>`. This component
 * then sheds its mobile frame chrome and renders straight into that content
 * area. Below `lg` everything is byte-for-byte unchanged: the 480px `APP_FRAME`,
 * its own `ThemeProvider`, the `ExitingBanner`.
 */
export function TenantAppShell() {
  // Before any layout branch, so it runs on every signed-in tenant screen.
  usePushAutoRegister();
  const desktopShell = useTenantDesktopShell();

  if (desktopShell) {
    return (
      <>
        <ExitingBanner />
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </>
    );
  }

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
