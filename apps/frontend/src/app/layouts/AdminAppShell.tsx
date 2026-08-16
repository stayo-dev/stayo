import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutGrid, Building2, UserPlus, FileCheck, IndianRupee, MoreHorizontal, Search, Bell } from 'lucide-react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';
import { useAdminSession } from '@features/admin-session/useAdminSession';
import { platformAdminService } from '@features/platform-admin/api';
import { ACTIONABLE_STATUSES } from '@/platforms/admin/leads/leadQueue';

/**
 * Admin console shell — sidebar chrome per Stayo Admin.dc.html. Desktop
 * (≥900px, matching the mockup's own breakpoint): logo/nav/admin-profile
 * sidebar + a top bar (page title/subtitle, search, notifications, avatar —
 * `.sc-topbar`, added 2026-07-27, was missing entirely before). Below 900px
 * the mockup switches to a floating bottom-nav pill (`.sc-bottom-nav`) driven
 * off the same tabs as the sidebar — both built from `ADMIN_TABS` below so
 * there's one source of truth for the tab list.
 */
const ADMIN_TABS = [
  { to: '/admin', label: 'Dashboard', icon: LayoutGrid, end: true },
  { to: '/admin/owners', label: 'Owners', icon: Building2 },
  { to: '/admin/leads', label: 'Leads', icon: UserPlus },
  { to: '/admin/documents', label: 'Documents', icon: FileCheck },
  { to: '/admin/revenue', label: 'Revenue', icon: IndianRupee },
  { to: '/admin/more', label: 'More', icon: MoreHorizontal },
];

const PAGE_HEADERS: Record<string, { title: string; subtitle: string }> = {
  '/admin': { title: 'Dashboard', subtitle: 'How Stayo is doing today' },
  '/admin/owners': { title: 'Owners', subtitle: 'Every business using Stayo' },
  '/admin/hostels': { title: 'Hostels', subtitle: 'Every hostel on the platform' },
  '/admin/leads': { title: 'Leads', subtitle: 'Prospective hostel owners' },
  '/admin/documents': { title: 'Owner documents', subtitle: 'Verify Aadhaar and PAN before a hostel goes live' },
  '/admin/support-tickets': { title: 'Support tickets', subtitle: 'App/website problems reported via Profile → Raise a ticket' },
  '/admin/revenue': { title: 'Revenue', subtitle: 'Subscriptions and platform billing' },
  '/admin/more': { title: 'More', subtitle: 'Settings, support & broadcast' },
  '/admin/settings': { title: 'Settings', subtitle: 'Configure the admin console' },
};

const initials = (name: string) => name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function AdminAppShell() {
  const session = useAdminSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [notifOpen, setNotifOpen] = useState(false);
  const header = PAGE_HEADERS[location.pathname] ?? { title: 'Stayo Admin', subtitle: '' };
  const notifications = useQuery({
    queryKey: ['admin', 'notifications'],
    queryFn: () => platformAdminService.getNotifications(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  // Leads get their own badge rather than folding into the bell — clicking
  // it goes straight to the Leads queue, not a dropdown, since leads already
  // have one dedicated place to work them. limit: 1 keeps the payload light;
  // `counts` is a groupBy that's computed regardless of how many rows are
  // returned. See docs/obsidian/Bugs.md, 2026-08-07.
  const leadCounts = useQuery({
    queryKey: ['admin', 'leads', 'counts'],
    queryFn: () => platformAdminService.getLeads({ limit: 1 }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const actionableLeadCount = ACTIONABLE_STATUSES.reduce(
    (sum, status) => sum + (leadCounts.data?.counts?.[status] ?? 0),
    0,
  );

  return (
    <ThemeProvider theme="product">
      <div className="flex h-screen w-full overflow-hidden bg-[#F3E9E3] [background-image:linear-gradient(#E6D5C9_1px,transparent_1px),linear-gradient(90deg,#E6D5C9_1px,transparent_1px)] [background-size:64px_64px]">
        <aside className="hidden h-full w-[246px] flex-shrink-0 flex-col border-r border-border bg-card min-[900px]:flex">
          <div className="flex h-16 flex-shrink-0 items-center gap-2.5 px-5">
            <img src="/stayo-dev.png" alt="Stayo" className="h-9 w-9 flex-none rounded-[9px] object-cover" />
            <div className="flex flex-col leading-tight">
              <span className="font-display text-[17px] font-extrabold text-foreground">Stayo</span>
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Admin Console</span>
            </div>
          </div>

          <nav className="flex flex-col gap-1 overflow-y-auto px-3.5 py-2">
            {ADMIN_TABS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold ${
                    isActive ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50'
                  }`
                }
              >
                <Icon className="h-4.5 w-4.5" />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto flex-shrink-0 p-3.5">
            <div className="flex items-center gap-2.5 rounded-xl border border-border bg-background/60 p-2.5">
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-foreground font-display text-[12px] font-bold text-background">
                {initials(session.name)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-[12.5px] font-bold text-foreground">{session.name}</div>
                <div className="text-[11px] text-muted-foreground">Platform Admin</div>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 flex-shrink-0 items-center gap-4 border-b border-[#EFE6DA] bg-[#F3E9E3]/85 px-3.5 backdrop-blur-sm sm:px-7">
            <div className="flex min-w-0 flex-col leading-tight">
              <h1 className="font-display text-[16.5px] font-bold text-foreground">{header.title}</h1>
              {header.subtitle && <span className="truncate text-[12px] text-[#9C9186]">{header.subtitle}</span>}
            </div>
            <div className="flex-1" />
            <div className="hidden h-9.5 w-[260px] flex-none items-center gap-2 rounded-[10px] border border-[#E7DDD1] bg-white px-3 min-[640px]:flex">
              <Search className="h-4 w-4 flex-none text-[#9C9186]" />
              <input placeholder="Search leads, hostels…" className="w-full border-none bg-transparent text-[13px] text-foreground outline-none" />
            </div>
            <button
              type="button"
              onClick={() => navigate('/admin/leads')}
              className="relative flex h-9.5 w-9.5 flex-none items-center justify-center rounded-[10px] border border-[#E7DDD1] bg-white text-[#8A7F75] hover:text-foreground"
              aria-label={`${actionableLeadCount} leads need you`}
            >
              <UserPlus className="h-[18px] w-[18px]" strokeWidth={1.9} />
              {actionableLeadCount > 0 && (
                <span className="absolute -right-1 -top-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold tabular-nums text-white">
                  +{actionableLeadCount}
                </span>
              )}
            </button>
            <div className="relative flex-none">
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                className="relative flex h-9.5 w-9.5 items-center justify-center rounded-[10px] border border-[#E7DDD1] bg-white text-[#8A7F75] hover:text-foreground"
              >
                <Bell className="h-[18px] w-[18px]" strokeWidth={1.9} />
                {(notifications.data?.length ?? 0) > 0 && (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
                )}
              </button>
              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-[69]" onClick={() => setNotifOpen(false)} />
                  <div className="absolute right-0 top-[46px] z-[70] w-[340px] max-w-[86vw] overflow-hidden rounded-[14px] border border-[#EFE6DA] bg-white shadow-[0_20px_45px_-20px_rgba(40,30,20,0.3)]">
                    <div className="flex items-center justify-between border-b border-[#EFE6DA] px-4 py-3.5">
                      <span className="font-display text-[13.5px] font-bold text-foreground">Notifications</span>
                    </div>
                    <div className="max-h-[360px] overflow-y-auto">
                      {notifications.isLoading ? (
                        <div className="px-4 py-6 text-center text-[12px] text-[#8A7F75]">Loading…</div>
                      ) : notifications.data && notifications.data.length > 0 ? (
                        notifications.data.map((n) => (
                          <div key={n.id} className="flex items-start gap-2.5 border-b border-[#F2ECE5] px-4 py-3 last:border-b-0">
                            <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full" style={{ background: n.color }} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[12.5px] font-semibold text-foreground">{n.title}</div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-[11.5px] text-[#9C9186]">{n.sub}</span>
                                <span className="flex-none text-[11px] text-[#9C9186]">{timeAgo(n.time as unknown as string)}</span>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="px-4 py-6 text-center text-[12px] text-[#8A7F75]">No notifications yet.</div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            <span className="flex h-9.5 w-9.5 flex-none items-center justify-center rounded-[10px] bg-foreground text-[12.5px] font-bold text-background">
              {initials(session.name)}
            </span>
          </header>

          <main className="min-w-0 flex-1 overflow-y-auto pb-[calc(92px+env(safe-area-inset-bottom,0px))] min-[900px]:pb-0">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>

        <nav className="fixed inset-x-3 bottom-3 z-40 flex h-[66px] items-stretch justify-around rounded-3xl bg-card pb-[env(safe-area-inset-bottom,0px)] shadow-[0_12px_32px_-10px_rgba(40,30,20,0.22),0_2px_8px_-2px_rgba(40,30,20,0.08)] min-[900px]:hidden">
          {ADMIN_TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className="flex flex-1 flex-col items-center justify-center gap-1 text-[10.5px]"
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`flex h-6.5 w-11 items-center justify-center rounded-full ${
                      isActive ? 'bg-primary/10' : ''
                    }`}
                  >
                    <Icon
                      className="h-5 w-5"
                      strokeWidth={isActive ? 2.5 : 2}
                      color={isActive ? 'var(--primary)' : 'var(--muted-foreground)'}
                    />
                  </span>
                  <span className={isActive ? 'font-bold text-primary' : 'font-medium text-muted-foreground'}>
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </ThemeProvider>
  );
}
