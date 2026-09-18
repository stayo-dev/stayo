import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { platformAdminService } from '@features/platform-admin/api';
import { useAuth } from '@context/AuthContext';
import { StatCard, EmptyState } from '../ui';
import { ADMIN_CARD } from '../theme/palette';
import { hasManagerPermission } from '../managers/permissions';
import { computeOnboardingChecklist } from '../onboarding/onboardingChecklist';
import { serializeDetail } from '../drawer/drawerParam';

/**
 * A manager's own landing page at `/admin` (spec §6) — only what's relevant
 * to them, never the platform-wide Overview an ADMIN session sees (that
 * page's `getDashboard()` call is ADMIN-only and would 403 for a manager).
 *
 * "Assigned hostels" is read from `GET /platform-admin/hostels`, which is
 * already scoped server-side to exactly this manager's active assignments
 * (`scopeHostelIds`) — no separate "my hostels" endpoint needed. Requires
 * the MANAGE_HOSTELS permission like the rest of that module; a manager
 * without it sees an honest note instead of a 403 crash.
 */
export function ManagerDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canSeeHostels = hasManagerPermission(user?.role, user?.manager_permissions, 'MANAGE_HOSTELS');
  const canSeeSupport = hasManagerPermission(user?.role, user?.manager_permissions, 'SUPPORT_REPORTS_BUGS');

  const hostels = useQuery({
    queryKey: ['admin', 'hostels', 'manager-dashboard'],
    queryFn: () => platformAdminService.getHostels(),
    enabled: canSeeHostels,
    staleTime: 30_000,
  });

  const tickets = useQuery({
    queryKey: ['admin', 'support-tickets', 'OPEN', 'manager-dashboard'],
    queryFn: () => platformAdminService.getSupportTickets('OPEN'),
    enabled: canSeeSupport,
    staleTime: 30_000,
  });

  const rows = (hostels.data ?? []).map((h: any) => {
    const checklist = computeOnboardingChecklist({
      verification_status: h.verification_status ?? null,
      listing_status: h.listing_status ?? null,
      rooms: Number(h.rooms ?? 0),
      capacity: Number(h.capacity ?? 0),
      tenants: Number(h.tenants ?? 0),
      revenue: Number(h.revenue ?? 0),
      subscription_status: h.subscription_status ?? null,
    });
    return { ...h, checklist };
  });

  const pendingCount = rows.filter((r: any) => r.checklist.status === 'in_progress').length;
  const onboardingCount = rows.filter((r: any) => r.verification_status !== 'VERIFIED').length;

  return (
    <div className="flex animate-[adFade_.25s_ease] flex-col gap-5">
      <div>
        <h1 className="font-admin text-[19px] font-extrabold text-[#221E1A]">Welcome, {user?.name?.split(' ')[0] ?? 'there'}.</h1>
        <p className="mt-0.5 text-[12.5px] text-[#8A7F75]">Here's what needs your attention today.</p>
      </div>

      <div className="grid grid-cols-2 gap-[13px] lg:grid-cols-4">
        <StatCard label="Assigned hostels" value={String(rows.length)} sub="in your scope" />
        <StatCard label="Pending tasks" value={String(pendingCount)} sub="onboarding incomplete" valueTone={pendingCount > 0 ? 'amber' : 'ink'} />
        <StatCard label="Onboarding" value={String(onboardingCount)} sub="not yet verified" valueTone={onboardingCount > 0 ? 'amber' : 'ink'} />
        <StatCard
          label="Support requests"
          value={canSeeSupport ? String(tickets.data?.length ?? 0) : '—'}
          sub={canSeeSupport ? 'open, platform-wide' : 'no access'}
        />
      </div>

      {!canSeeHostels ? (
        <EmptyState title="No hostel access" message="You don't have the Hostels permission yet — ask your Super Admin to grant it." />
      ) : hostels.isLoading ? (
        <div className="py-16 text-center text-[13px] text-[#8A7F75]">Loading your hostels…</div>
      ) : rows.length === 0 ? (
        <EmptyState title="No hostels assigned yet" message="Your Super Admin hasn't assigned you any hostels." />
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((h: any) => (
            <button
              key={h.id}
              type="button"
              onClick={() => navigate(`/admin/owners?detail=${serializeDetail({ kind: 'owner', id: h.owner_id })}`)}
              className={`${ADMIN_CARD} flex items-center justify-between gap-3 px-5 py-4 text-left`}
            >
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-semibold text-[#2A2521]">{h.name}</div>
                <div className="mt-0.5 truncate text-[11.5px] text-[#9A8F84]">
                  Onboarding: {h.checklist.completed}/{h.checklist.total}
                </div>
              </div>
              <span
                className="flex-none rounded-full px-2.5 py-1 text-[11px] font-bold"
                style={
                  h.checklist.status === 'complete'
                    ? { background: '#EAF3EE', color: '#1F7A52' }
                    : { background: '#FBF1DE', color: '#B8792B' }
                }
              >
                {h.checklist.status === 'complete' ? 'Active' : 'In Progress'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
