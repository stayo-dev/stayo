import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Search, Bell, Calendar, LogOut, Menu, X } from 'lucide-react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';
import { useAuth } from '@context/AuthContext';
import { useAdminSession } from '@features/admin-session/useAdminSession';
import { platformAdminService } from '@features/platform-admin/api';
import { ACTIONABLE_STATUSES } from '@/platforms/admin/leads/leadQueue';
import { buildAdminNav, isNavItemActive } from './adminNav';
import { headerFor } from './pageHeaders';
import { ClerkUserButton } from '@/app/components/ClerkUserButton';
import { AdminToast, useAdminToast } from '../ui/Toast';
import { AdminToastContext } from './toastContext';

const initialsOf = (name: string) =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

const BADGE_BG: Record<string, string> = {
  amber: '#B8792B',
  accent: '#B46A55',
  red: '#B3402F',
};

type NavGroups = ReturnType<typeof buildAdminNav>;

/**
 * The sidebar's contents — logo, nav groups, profile/sign-out footer.
 * Rendered once inside the persistent desktop `<aside>` and once inside the
 * mobile off-canvas drawer, so the two never drift into separate nav systems.
 * `onNavigate` closes the drawer on mobile after a link is followed; it is a
 * no-op on desktop, where there is no drawer to close.
 */
function SidebarNav({
  navGroups, pathname, sessionName, onLogout, onNavigate,
}: {
  navGroups: NavGroups;
  pathname: string;
  sessionName: string;
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-[11px] px-[22px] pb-[18px] pt-[22px]">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-[#B46A55] font-admin text-[17px] font-extrabold text-white shadow-[0_4px_12px_rgba(180,106,85,.4)]">
          S
        </span>
        <div className="leading-[1.1]">
          <div className="font-admin text-base font-extrabold tracking-[-0.02em] text-white">Stayo</div>
          <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#8A7F75]">
            Admin Console
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-auto px-3 pb-3 pt-1.5">
        {navGroups.map((group) => (
          <div key={group.label} className="flex flex-col gap-[3px]">
            <div className="px-2.5 pb-1 pt-0.5 text-[9.5px] font-bold uppercase tracking-[.13em] text-muted-foreground">
              {group.label}
            </div>
            {group.items.map(({ to, label, icon: Icon, badge, badgeTone, end }) => {
              const active = isNavItemActive(to, pathname, end);
              return (
                <NavLink
                  key={to}
                  to={to}
                  onClick={onNavigate}
                  className={`flex items-center gap-[11px] rounded-[11px] px-[11px] py-[9px] text-[13px] transition-colors ${
                    active
                      ? 'bg-[#B46A55] font-bold text-white'
                      : 'font-medium text-[#A79C90] hover:bg-white/[.06]'
                  }`}
                >
                  <Icon className="h-5 w-5 flex-none" strokeWidth={1.5} />
                  <span className="flex-1">{label}</span>
                  {badge > 0 && (
                    <span
                      className="flex h-[19px] min-w-[19px] items-center justify-center rounded-full px-[5px] font-admin text-[10.5px] font-bold text-white"
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
      </div>

      <div className="border-t border-white/[.07] p-3">
        <div className="flex items-center gap-[11px] rounded-xl bg-white/[.04] px-2.5 py-2">
          <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-[#B46A55] font-admin text-[12px] font-bold text-white">
            {initialsOf(sessionName)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold text-[#EDE6DE]">{sessionName}</div>
            <div className="text-[10.5px] font-medium text-[#8A7F75]">Platform Admin</div>
          </div>
          <span className="h-[7px] w-[7px] flex-none rounded-full bg-[#4FA97C]" />
        </div>
        {/* The console's only sign-out control — accessible from both the
            desktop sidebar and the mobile drawer, so an admin always has a
            way to end their session regardless of viewport. */}
        <button
          type="button"
          onClick={onLogout}
          className="mt-1.5 flex w-full items-center gap-[11px] rounded-xl px-2.5 py-2 text-[12.5px] font-semibold text-[#A79C90] transition-colors hover:bg-white/[.06] hover:text-[#EDE6DE]"
        >
          <LogOut className="h-4 w-4 flex-none" strokeWidth={1.7} />
          Sign out
        </button>
      </div>
    </>
  );
}

/**
 * Admin console shell, per `Stayo Admin.dc.html`: a dark 250px sidebar with
 * four labelled nav groups, a topbar carrying the page title and search, and
 * a scrolling body over the design's grid-paper background.
 *
 * Badge counts come from the same queries the screens themselves use, so the
 * sidebar can never advertise a queue that the screen then shows as empty.
 */
export function AdminConsoleShell() {
  const session = useAdminSession();
  const { logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [notifOpen, setNotifOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  // Belt-and-braces close on any route change — NavLink's own onClick covers
  // the common case, but this also catches a programmatic navigate() (e.g.
  // from search) reaching a page without going through the drawer's links.
  useEffect(() => {
    setMobileNavOpen(false);
    setMobileSearchOpen(false);
  }, [location.pathname]);
  const { toast, fire } = useAdminToast();
  const header = headerFor(location.pathname);

  const poll = { staleTime: 30_000, refetchInterval: 60_000 } as const;

  // The "Leads" nav badge mirrors what the Leads screen itself lists — Admin
  // -> Add Owner leads never appear there, so they're excluded here too.
  const leadCounts = useQuery({
    queryKey: ['admin', 'leads', 'counts'],
    queryFn: () => platformAdminService.getLeads({ source: 'WEBSITE', limit: 1 }),
    ...poll,
  });
  const pendingHostels = useQuery({
    queryKey: ['admin', 'hostels', { verification: 'PENDING' }],
    queryFn: () => platformAdminService.getHostels({ verification: 'PENDING' }),
    ...poll,
  });
  const openTickets = useQuery({
    queryKey: ['admin', 'support-tickets', 'OPEN'],
    queryFn: () => platformAdminService.getSupportTickets('OPEN'),
    ...poll,
  });
  const notifications = useQuery({
    queryKey: ['admin', 'notifications'],
    queryFn: () => platformAdminService.getNotifications(),
    ...poll,
  });

  const actionableLeads = ACTIONABLE_STATUSES.reduce(
    (sum, status) => sum + (leadCounts.data?.counts?.[status] ?? 0),
    0,
  );
  const navGroups = buildAdminNav({
    leads: actionableLeads,
    listings: pendingHostels.data?.length ?? 0,
    reports: openTickets.data?.length ?? 0,
  });

  const runSearch = () => {
    const q = globalSearch.trim();
    if (!q) return;
    navigate(`/admin/owners?search=${encodeURIComponent(q)}`);
    setMobileSearchOpen(false);
  };

  return (
    <ThemeProvider theme="product">
      <AdminToastContext.Provider value={fire}>
        <div className="admin-console flex h-screen w-full overflow-hidden bg-[#EFE9E2] text-[#221E1A]">
          {/* ── sidebar (desktop, persistent ≥900px) ───────────────── */}
          <aside className="hidden h-full w-[250px] flex-none flex-col bg-[#201C18] min-[900px]:flex">
            <SidebarNav
              navGroups={navGroups}
              pathname={location.pathname}
              sessionName={session.name}
              onLogout={() => logout()}
            />
          </aside>

          {/* ── sidebar (mobile, off-canvas drawer <900px) ─────────── */}
          {mobileNavOpen && (
            <div className="fixed inset-0 z-[95] min-[900px]:hidden">
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMobileNavOpen(false)}
                className="absolute inset-0 animate-[adFade_.2s_ease] bg-[rgba(28,22,18,.5)]"
              />
              <div className="relative flex h-full w-[270px] max-w-[82vw] animate-[adDrawerLeft_.28s_cubic-bezier(.22,1,.36,1)] flex-col bg-[#201C18] shadow-[0_0_40px_rgba(0,0,0,.35)]">
                <SidebarNav
                  navGroups={navGroups}
                  pathname={location.pathname}
                  sessionName={session.name}
                  onLogout={() => { setMobileNavOpen(false); logout(); }}
                  onNavigate={() => setMobileNavOpen(false)}
                />
              </div>
            </div>
          )}

          {/* ── main ────────────────────────────────────────────────── */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <header className="relative flex h-[72px] flex-none items-center gap-2.5 border-b border-[#E6DCD1] bg-[#F7F3EF] px-3 sm:gap-4 sm:px-[30px]">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open menu"
                className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] border border-border bg-white text-[#5A5147] min-[900px]:hidden"
              >
                <Menu className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>

              <div className="min-w-0">
                <div className="truncate font-admin text-[17px] font-extrabold tracking-[-0.025em] text-[#221E1A] sm:text-xl">
                  {header.title}
                </div>
                <div className="mt-px hidden truncate text-[12px] font-medium text-[#8A7F75] sm:block">
                  {header.subtitle}
                </div>
              </div>
              <div className="flex-1" />

              <div className="hidden w-[300px] items-center gap-2 rounded-[11px] border border-border bg-white px-3 py-[9px] min-[1100px]:flex">
                <Search className="h-3.5 w-3.5 flex-none text-[#988D82]" />
                {/* Routes to Owners, whose search spans owner name/email/phone
                    plus the city and name of any hostel they run — so one box
                    answers "who is this" and "where is this". */}
                <input
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                  placeholder="Search owners, hostels, cities…"
                  className="w-full min-w-0 border-none bg-transparent text-[12.5px] text-[#2A2521] outline-none"
                />
              </div>

              {/* Below 1100px the inline search box has nowhere to go, so it
                  collapses to an icon that opens the same search as a
                  full-width row under the header instead of forcing overflow. */}
              <button
                type="button"
                onClick={() => setMobileSearchOpen((o) => !o)}
                aria-label="Search"
                aria-expanded={mobileSearchOpen}
                className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] border border-border bg-white text-[#5A5147] min-[1100px]:hidden"
              >
                <Search className="h-[17px] w-[17px]" strokeWidth={1.6} />
              </button>

              <div className="hidden items-center gap-2 rounded-[11px] border border-border bg-white px-[13px] py-[9px] text-[12.5px] font-semibold text-[#5A5147] min-[1300px]:flex">
                <Calendar className="h-3.5 w-3.5 text-[#8A7F75]" />
                Last 30 days
              </div>

              <div className="relative flex-none">
                <button
                  type="button"
                  onClick={() => setNotifOpen((o) => !o)}
                  aria-label="Notifications"
                  className="relative flex h-10 w-10 items-center justify-center rounded-[11px] border border-border bg-white text-[#5A5147]"
                >
                  <Bell className="h-[17px] w-[17px]" strokeWidth={1.6} />
                  {(notifications.data?.length ?? 0) > 0 && (
                    <span className="absolute right-[9px] top-2 h-[7px] w-[7px] rounded-full border-[1.5px] border-white bg-[#B3402F]" />
                  )}
                </button>
                {notifOpen && (
                  <>
                    <div className="fixed inset-0 z-[69]" onClick={() => setNotifOpen(false)} />
                    <div className="absolute right-0 top-[50px] z-[70] w-[340px] max-w-[86vw] overflow-hidden rounded-[14px] border border-[#EFE6DA] bg-white shadow-[0_20px_45px_-20px_rgba(40,30,20,0.3)]">
                      <div className="border-b border-[#EFE6DA] px-4 py-3.5 font-admin text-[13.5px] font-bold text-[#221E1A]">
                        Notifications
                      </div>
                      <div className="max-h-[360px] overflow-y-auto">
                        {notifications.isLoading ? (
                          <div className="px-4 py-6 text-center text-[12px] text-[#8A7F75]">Loading…</div>
                        ) : notifications.data && notifications.data.length > 0 ? (
                          notifications.data.map((n) => (
                            <div
                              key={n.id}
                              className="flex items-start gap-2.5 border-b border-[#F2ECE5] px-4 py-3 last:border-b-0"
                            >
                              <span
                                className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full"
                                style={{ background: n.color }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[12.5px] font-semibold text-[#2A2521]">{n.title}</div>
                                <div className="truncate text-[11.5px] text-[#9A8F84]">{n.sub}</div>
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
              {/* ADR-176 Phase 2: renders nothing without a Clerk session. */}
              <ClerkUserButton />

              {mobileSearchOpen && (
                <div className="absolute inset-x-0 top-full z-[80] flex items-center gap-2 border-b border-[#E6DCD1] bg-[#F7F3EF] px-3 py-2.5 min-[1100px]:hidden">
                  <div className="flex flex-1 items-center gap-2 rounded-[11px] border border-border bg-white px-3 py-[9px]">
                    <Search className="h-3.5 w-3.5 flex-none text-[#988D82]" />
                    <input
                      autoFocus
                      value={globalSearch}
                      onChange={(e) => setGlobalSearch(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                      placeholder="Search owners, hostels, cities…"
                      className="w-full min-w-0 border-none bg-transparent text-[12.5px] text-[#2A2521] outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setMobileSearchOpen(false)}
                    aria-label="Close search"
                    className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] border border-border bg-white text-[#5A5147]"
                  >
                    <X className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                </div>
              )}
            </header>

            <main className="min-w-0 flex-1 overflow-auto bg-[#EFE9E2] px-3 pb-8 pt-5 [background-image:linear-gradient(#E3D8CB_1px,transparent_1px),linear-gradient(90deg,#E3D8CB_1px,transparent_1px)] [background-size:52px_52px] sm:px-[30px] sm:pb-11 sm:pt-[26px]">
              <ErrorBoundary>
                <Outlet />
              </ErrorBoundary>
            </main>
          </div>

          <AdminToast toast={toast} />
        </div>
      </AdminToastContext.Provider>
    </ThemeProvider>
  );
}
