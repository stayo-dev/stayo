import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Search, Bell, Calendar, LogOut } from 'lucide-react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';
import { useAuth } from '@context/AuthContext';
import { useAdminSession } from '@features/admin-session/useAdminSession';
import { platformAdminService } from '@features/platform-admin/api';
import { ACTIONABLE_STATUSES } from '@/platforms/admin/leads/leadQueue';
import { buildAdminNav, isNavItemActive } from './adminNav';
import { headerFor } from './pageHeaders';
import { AdminToast, useAdminToast } from '../ui/Toast';
import { AdminToastContext } from './toastContext';

const initialsOf = (name: string) =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

const BADGE_BG: Record<string, string> = {
  amber: '#B8792B',
  accent: '#B46A55',
  red: '#B3402F',
};

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
  const { toast, fire } = useAdminToast();
  const header = headerFor(location.pathname);

  const poll = { staleTime: 30_000, refetchInterval: 60_000 } as const;

  const leadCounts = useQuery({
    queryKey: ['admin', 'leads', 'counts'],
    queryFn: () => platformAdminService.getLeads({ limit: 1 }),
    ...poll,
  });
  const pendingDocuments = useQuery({
    queryKey: ['admin', 'owner-documents', 'PENDING'],
    queryFn: () => platformAdminService.getOwnerDocuments('PENDING'),
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
  // KYC is a queue of owners, not of files — several documents from one owner
  // are one thing to review, so counting rows would overstate the backlog.
  const pendingKycOwners = new Set((pendingDocuments.data ?? []).map((d) => d.profile.id)).size;

  const navGroups = buildAdminNav({
    leads: actionableLeads,
    kyc: pendingKycOwners,
    listings: pendingHostels.data?.length ?? 0,
    reports: openTickets.data?.length ?? 0,
  });

  return (
    <ThemeProvider theme="product">
      <AdminToastContext.Provider value={fire}>
        <div className="admin-console flex h-screen w-full overflow-hidden bg-[#EFE9E2] text-[#221E1A]">
          {/* ── sidebar ─────────────────────────────────────────────── */}
          <aside className="hidden h-full w-[250px] flex-none flex-col bg-[#201C18] min-[900px]:flex">
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
                  <div className="px-2.5 pb-1 pt-0.5 text-[9.5px] font-bold uppercase tracking-[.13em] text-[#6B6259]">
                    {group.label}
                  </div>
                  {group.items.map(({ to, label, icon: Icon, badge, badgeTone, end }) => {
                    const active = isNavItemActive(to, location.pathname, end);
                    return (
                      <NavLink
                        key={to}
                        to={to}
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
                  {initialsOf(session.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-[#EDE6DE]">{session.name}</div>
                  <div className="text-[10.5px] font-medium text-[#8A7F75]">Platform Admin</div>
                </div>
                <span className="h-[7px] w-[7px] flex-none rounded-full bg-[#4FA97C]" />
              </div>
              {/* The console's only sign-out control. It lived on the old
                  "More" page, which this rebuild removed — without this the
                  admin has no way out. Covered by logoutIntegrity.test.ts. */}
              <button
                type="button"
                onClick={() => logout()}
                className="mt-1.5 flex w-full items-center gap-[11px] rounded-xl px-2.5 py-2 text-[12.5px] font-semibold text-[#A79C90] transition-colors hover:bg-white/[.06] hover:text-[#EDE6DE]"
              >
                <LogOut className="h-4 w-4 flex-none" strokeWidth={1.7} />
                Sign out
              </button>
            </div>
          </aside>

          {/* ── main ────────────────────────────────────────────────── */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <header className="flex h-[72px] flex-none items-center gap-4 border-b border-[#E6DCD1] bg-[#F7F3EF] px-4 sm:px-[30px]">
              <div className="min-w-0">
                <div className="font-admin text-xl font-extrabold tracking-[-0.025em] text-[#221E1A]">
                  {header.title}
                </div>
                <div className="mt-px truncate text-[12px] font-medium text-[#8A7F75]">{header.subtitle}</div>
              </div>
              <div className="flex-1" />

              <div className="hidden w-[300px] items-center gap-2 rounded-[11px] border border-[#EAE1D8] bg-white px-3 py-[9px] min-[1100px]:flex">
                <Search className="h-3.5 w-3.5 flex-none text-[#988D82]" />
                {/* Routes to Owners, whose search spans owner name/email/phone
                    plus the city and name of any hostel they run — so one box
                    answers "who is this" and "where is this". */}
                <input
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    const q = globalSearch.trim();
                    if (!q) return;
                    navigate(`/admin/owners?search=${encodeURIComponent(q)}`);
                  }}
                  placeholder="Search owners, hostels, cities…"
                  className="w-full min-w-0 border-none bg-transparent text-[12.5px] text-[#2A2521] outline-none"
                />
              </div>

              <div className="hidden items-center gap-2 rounded-[11px] border border-[#EAE1D8] bg-white px-[13px] py-[9px] text-[12.5px] font-semibold text-[#5A5147] min-[1300px]:flex">
                <Calendar className="h-3.5 w-3.5 text-[#8A7F75]" />
                Last 30 days
              </div>

              <div className="relative flex-none">
                <button
                  type="button"
                  onClick={() => setNotifOpen((o) => !o)}
                  aria-label="Notifications"
                  className="relative flex h-10 w-10 items-center justify-center rounded-[11px] border border-[#EAE1D8] bg-white text-[#5A5147]"
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
            </header>

            <main className="min-w-0 flex-1 overflow-auto bg-[#EFE9E2] px-4 pb-11 pt-[26px] [background-image:linear-gradient(#E3D8CB_1px,transparent_1px),linear-gradient(90deg,#E3D8CB_1px,transparent_1px)] [background-size:52px_52px] sm:px-[30px]">
              <ErrorBoundary>
                <Outlet />
              </ErrorBoundary>
            </main>
          </div>

          {/* Below 900px the sidebar is hidden; a compact nav strip keeps the
              console navigable on a laptop-in-tablet-mode without rebuilding
              the design's desktop-first layout. */}
          <nav className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-[#E6DCD1] bg-[#201C18] px-2 py-1.5 min-[900px]:hidden">
            {navGroups.flatMap((g) => g.items).map(({ to, label, icon: Icon, end }) => {
              const active = isNavItemActive(to, location.pathname, end);
              return (
                <button
                  key={to}
                  type="button"
                  onClick={() => navigate(to)}
                  className={`flex flex-none flex-col items-center gap-1 px-3 py-1.5 text-[10px] ${
                    active ? 'font-bold text-[#B46A55]' : 'font-medium text-[#8A7F75]'
                  }`}
                >
                  <Icon className="h-4.5 w-4.5" strokeWidth={active ? 2.2 : 1.7} />
                  {label}
                </button>
              );
            })}
          </nav>

          <AdminToast toast={toast} />
        </div>
      </AdminToastContext.Provider>
    </ThemeProvider>
  );
}
