import { Outlet } from 'react-router-dom';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';

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
      <div className="flex min-h-screen flex-col bg-background text-foreground [background-image:linear-gradient(#EBDCCF_1px,transparent_1px),linear-gradient(90deg,#EBDCCF_1px,transparent_1px)] [background-size:52px_52px] sm:mx-auto sm:max-w-[480px] sm:border-x sm:border-border">
        <main className="flex-1">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </ThemeProvider>
  );
}
