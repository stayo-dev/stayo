import { NavLink, Outlet } from 'react-router-dom';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';
import { DASHBOARD_TABS } from '@/app/nav/appNavConfig';

/**
 * The Tenant Dashboard's *inner* shell — Home / Money / Room / Food /
 * Complaints, per `appNavConfig.DASHBOARD_TABS` (ADR-078 supersedes
 * ADR-068's "no Complaints tab" call; Profile moved out to the app-wide
 * outer nav, shared with Explore). No longer owns the fixed-bottom bar
 * itself — `AppShell`'s `AppBottomNav` (Explore/Dashboard/Profile) does
 * that one level up; this renders as a `sticky top-0` strip directly below
 * it, so the two nav layers never stack as two competing bottom bars.
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
        <nav className="sticky top-0 z-30 border-b border-border bg-card shadow-[0_4px_16px_rgba(40,30,20,0.03)]">
          <div className="mx-auto grid max-w-md grid-cols-5">
            {DASHBOARD_TABS.map(({ to, label, Icon: Icon }) => (
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
                        className="h-[22px] w-[22px]"
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

        <main className="flex-1">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </ThemeProvider>
  );
}
