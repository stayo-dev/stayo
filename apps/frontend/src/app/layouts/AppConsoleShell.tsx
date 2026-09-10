import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Bell, LogOut } from 'lucide-react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';
import { APP_GRID } from '@shared/ui/surface';
import { isNavItemActive, type NavGroup } from '@/app/nav/navTypes';
import { headerFor } from './appHeaders';

const BADGE_BG: Record<NonNullable<NavGroup['items'][number]['badgeTone']>, string> = {
  amber: 'var(--warning)',
  accent: 'var(--primary)',
  red: 'var(--destructive)',
};

interface AppConsoleShellProps {
  /** Sidebar navigation — `buildOwnerNav()` / `buildTenantNav()`. */
  nav: NavGroup[];
  /** Owner hostel switcher, rendered under the wordmark. Absent for tenant. */
  contextSlot?: ReactNode;
  /** Sidebar-footer identity card. */
  identity: { name: string; sublabel?: string; avatarUrl?: string | null };
  /** Topbar bell. */
  notifications?: { count: number; onOpen: () => void };
  /** Right-aligned topbar slot — the one primary action per screen. */
  actions?: ReactNode;
  /**
   * The sidebar-footer "Sign out" handler. **Must be wired to `AuthContext`'s
   * `logout`** (directly, or via a hook such as `useMoreNav().signOut` that
   * calls it) — a control that only navigates leaves the Supabase session
   * alive. Enforced for concrete call sites by `context/logoutIntegrity.test.ts`.
   */
  onSignOut: () => void;
  children: ReactNode;
}

/**
 * The unified desktop shell for Owner and Tenant — a persistent dark sidebar
 * (nav + hostel context + identity) and a light topbar (page title + one
 * contextual action + notifications) over a scrolling content area on the
 * app's grid-paper ground.
 *
 * Generalised from `platforms/admin/layout/AdminConsoleShell.tsx`, which
 * already runs this exact split. One primitive; Owner and Tenant differ only in
 * their `nav` config and whether `contextSlot` is present.
 *
 * Owns `<ThemeProvider theme="product">` so every page under it — including
 * `/profile`, which has no theme scope of its own on mobile — resolves the
 * `product` CSS-var tokens. `h-screen overflow-hidden` root so the content area
 * owns its own scroll (matching `AdminConsoleShell`), rather than the `<body>`
 * scroll `theme.css` sets up for the mobile layout.
 *
 * Rendered only at `lg+` — the caller (`OwnerAppShell` / `TenantAppShell`)
 * keeps its current mobile markup below `lg`. Introduced in Phase 0; wired in
 * Phase 1.
 */
export function AppConsoleShell({
  nav,
  contextSlot,
  identity,
  notifications,
  actions,
  onSignOut,
  children,
}: AppConsoleShellProps) {
  const location = useLocation();
  const header = headerFor(location.pathname);
  const initials = identity.name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <ThemeProvider theme="product">
      <div className="flex h-screen w-full overflow-hidden bg-[var(--sidebar)] text-foreground">
        {/* ── sidebar ─────────────────────────────────────────────── */}
        <aside className="flex h-full w-[248px] flex-none flex-col bg-[var(--sidebar)] text-[var(--sidebar-foreground)]">
          <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-[var(--primary)] font-display text-[16px] font-extrabold text-[var(--primary-foreground)] shadow-[0_4px_12px_rgba(180,106,85,.4)]">
              S
            </span>
            <span className="font-display text-lg font-extrabold tracking-[-0.02em] text-white">Stayo</span>
          </div>

          {contextSlot && <div className="px-3 pb-3">{contextSlot}</div>}

          <nav className="flex flex-1 flex-col gap-5 overflow-auto px-3 pb-3 pt-1">
            {nav.map((group, gi) => (
              <div key={group.label ?? gi} className="flex flex-col gap-[3px]">
                {group.label && (
                  <div className="px-2.5 pb-1 pt-0.5 text-[9.5px] font-bold uppercase tracking-[.13em] text-[var(--sidebar-foreground)]/60">
                    {group.label}
                  </div>
                )}
                {group.items.map(({ to, label, icon: Icon, badge = 0, badgeTone = 'amber', end }) => {
                  const active = isNavItemActive(to, location.pathname, end);
                  return (
                    <NavLink
                      key={to}
                      to={to}
                      end={end}
                      className={`flex items-center gap-[11px] rounded-[11px] px-[11px] py-[9px] text-[13px] transition-colors ${
                        active
                          ? 'bg-[var(--primary)] font-bold text-white'
                          : 'font-medium text-[var(--sidebar-foreground)] hover:bg-white/[.06]'
                      }`}
                    >
                      <Icon className="h-5 w-5 flex-none" strokeWidth={active ? 2 : 1.6} />
                      <span className="flex-1">{label}</span>
                      {badge > 0 && (
                        <span
                          className="flex h-[19px] min-w-[19px] items-center justify-center rounded-full px-[5px] font-display text-[10.5px] font-bold text-white"
                          style={{ background: BADGE_BG[badgeTone] }}
                        >
                          {badge}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="border-t border-white/[.07] p-3">
            <div className="flex items-center gap-[11px] rounded-xl bg-white/[.04] px-2.5 py-2">
              {identity.avatarUrl ? (
                <img src={identity.avatarUrl} alt="" className="h-[34px] w-[34px] flex-none rounded-full object-cover" />
              ) : (
                <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-[var(--primary)] font-display text-[12px] font-bold text-white">
                  {initials || 'S'}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold text-[var(--sidebar-foreground)]">
                  {identity.name}
                </div>
                {identity.sublabel && (
                  <div className="truncate text-[10.5px] font-medium text-[var(--sidebar-foreground)]/70">
                    {identity.sublabel}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="mt-1.5 flex w-full items-center gap-[11px] rounded-xl px-2.5 py-2 text-[12.5px] font-semibold text-[var(--sidebar-foreground)] transition-colors hover:bg-white/[.06] hover:text-white"
            >
              <LogOut className="h-4 w-4 flex-none" strokeWidth={1.7} />
              Sign out
            </button>
          </div>
        </aside>

        {/* ── main ────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-14 flex-none items-center gap-4 border-b border-border bg-card px-6">
            <div className="min-w-0">
              <div className="truncate font-display text-[17px] font-extrabold tracking-[-0.02em] text-foreground">
                {header.title}
              </div>
              {header.subtitle && (
                <div className="truncate text-[12px] font-medium text-muted-foreground">{header.subtitle}</div>
              )}
            </div>
            <div className="flex-1" />
            {actions}
            {notifications && (
              <button
                type="button"
                onClick={notifications.onOpen}
                aria-label="Notifications"
                className="relative flex h-10 w-10 flex-none items-center justify-center rounded-[11px] border border-border bg-card text-muted-foreground"
              >
                <Bell className="h-[17px] w-[17px]" strokeWidth={1.6} />
                {notifications.count > 0 && (
                  <span className="absolute right-2 top-2 h-[7px] w-[7px] rounded-full border-[1.5px] border-card bg-[var(--destructive)]" />
                )}
              </button>
            )}
          </header>

          <main className={`min-w-0 flex-1 overflow-auto bg-background ${APP_GRID}`}>
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
