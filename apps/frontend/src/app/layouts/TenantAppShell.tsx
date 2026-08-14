import { NavLink, Outlet } from 'react-router-dom';
import { Home, Wallet, DoorOpen, UtensilsCrossed, User } from 'lucide-react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';

/**
 * Tenant app shell — bottom-nav chrome per TenantNav.dc.html (Home / Money /
 * Room / Food / Profile). Flatter IA than the owner app (no drill-down beyond
 * the Room/Profile overlay system), one global modal type (pay sheet) — this
 * shell is just the persistent nav + content area, matching that simplicity.
 * No header/logo bar — the mockup has none (verified 2026-07-27 fidelity
 * audit; an earlier pass added one with no design basis, since removed).
 *
 * Desktop: same treatment as `OwnerAppShell` — `Stayo Tenant.dc.html` has no
 * `@media`/desktop rules (fixed 402x874 mobile device-frame mockup), so on
 * `sm:`+ viewports this centers the same mobile layout in a bordered 480px
 * frame rather than inventing a new breakpoint.
 */
const TENANT_TABS = [
  { to: '/tenant/home', label: 'Home', icon: Home },
  { to: '/tenant/money', label: 'Money', icon: Wallet },
  { to: '/tenant/room', label: 'Room', icon: DoorOpen },
  { to: '/tenant/food', label: 'Food', icon: UtensilsCrossed },
  { to: '/tenant/profile', label: 'Profile', icon: User },
];

export function TenantAppShell() {
  return (
    <ThemeProvider theme="product">
      <div className="flex min-h-screen flex-col bg-background text-foreground [background-image:linear-gradient(#EBDCCF_1px,transparent_1px),linear-gradient(90deg,#EBDCCF_1px,transparent_1px)] [background-size:52px_52px] sm:mx-auto sm:max-w-[480px] sm:border-x sm:border-border">
        <main className="flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-4px_16px_rgba(40,30,20,0.03)] sm:inset-x-auto sm:left-1/2 sm:w-[480px] sm:-translate-x-1/2">
          <div className="mx-auto grid max-w-md grid-cols-5">
            {TENANT_TABS.map(({ to, label, icon: Icon }) => (
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
      </div>
    </ThemeProvider>
  );
}
