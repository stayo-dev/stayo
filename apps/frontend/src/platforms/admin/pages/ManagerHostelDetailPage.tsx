import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { platformAdminService } from '@features/platform-admin/api';
import { useAuth } from '@context/AuthContext';
import { DrawerSection, KeyValueRows } from '../drawer/AdminDrawer';
import { SegmentedTabs, EmptyState, NotWiredYet } from '../ui';
import { ADMIN_CARD } from '../theme/palette';
import { hasManagerPermission } from '../managers/permissions';
import { computeOnboardingChecklist } from '../onboarding/onboardingChecklist';
import { formatInr } from '../owners/ownerRows';

/**
 * A hostel workspace scoped to what a manager (or admin) is permitted to
 * see (spec §7: "If Revenue permission is disabled, Revenue should not be
 * accessible"). Every tab's own data fetch goes through
 * `GET /platform-admin/hostels/:id`, which independently enforces
 * `assertHostelAccess` server-side — a permission-gated tab hidden here is a
 * UX nicety, not what actually stops a manager reaching another hostel's data.
 *
 * Rooms/Tenants/Food have no platform-admin API surface today (those are
 * owner-session-scoped endpoints, not reachable from an admin/manager
 * session) — rather than fabricate data for them, they render `NotWiredYet`,
 * this console's existing honest-gap pattern.
 */
export function ManagerHostelDetailPage() {
  const { hostelId } = useParams<{ hostelId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState('overview');

  const detail = useQuery({
    queryKey: ['admin', 'hostel', hostelId],
    queryFn: () => platformAdminService.getHostel(hostelId as string),
    enabled: Boolean(hostelId),
    staleTime: 20_000,
  });

  const can = (permission: Parameters<typeof hasManagerPermission>[2]) =>
    hasManagerPermission(user?.role, user?.manager_permissions, permission);

  if (detail.isLoading) {
    return <div className="py-16 text-center text-[13px] text-[#8A7F75]">Loading hostel…</div>;
  }
  if (detail.isError || !detail.data) {
    return <EmptyState title="Couldn't load this hostel" message="You may not have access to it, or it may not exist." />;
  }

  const hostel = detail.data;
  const checklist = computeOnboardingChecklist({
    verification_status: hostel.verification_status ?? null,
    listing_status: hostel.listing_status ?? null,
    rooms: Number(hostel.rooms ?? 0),
    capacity: Number(hostel.capacity ?? 0),
    tenants: Number(hostel.tenants ?? 0),
    revenue: Number(hostel.revenue ?? 0),
    subscription_status: hostel.subscription?.status ?? null,
  });

  const tabs = [
    { key: 'overview', label: 'Overview', visible: true },
    { key: 'onboarding', label: 'Onboarding', visible: can('MANAGE_ONBOARDING') || can('MANAGE_HOSTELS') },
    { key: 'owner', label: 'Owner', visible: can('MANAGE_OWNERS') },
    { key: 'rooms', label: 'Rooms', visible: can('MANAGE_HOSTELS') },
    { key: 'tenants', label: 'Tenants', visible: can('MANAGE_HOSTELS') },
    { key: 'food', label: 'Food', visible: can('MANAGE_HOSTELS') },
    { key: 'revenue', label: 'Revenue', visible: can('VIEW_REVENUE_ANALYTICS') },
    { key: 'support', label: 'Support', visible: can('SUPPORT_REPORTS_BUGS') },
  ].filter((t) => t.visible);

  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key;

  return (
    <div className="flex animate-[adFade_.25s_ease] flex-col gap-5">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-semibold text-[#8A7F75]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back
      </button>

      <div>
        <h1 className="font-admin text-[19px] font-extrabold text-[#221E1A]">{hostel.name}</h1>
        <p className="mt-0.5 text-[12.5px] text-[#8A7F75]">{hostel.city ?? '—'}</p>
      </div>

      <SegmentedTabs tabs={tabs.map((t) => ({ key: t.key, label: t.label }))} active={activeTab} onChange={setTab} />

      {activeTab === 'overview' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[
              { k: 'Tenants', v: String(hostel.tenants ?? 0) },
              { k: 'Rooms', v: String(hostel.rooms ?? 0) },
              { k: 'Occupancy', v: hostel.capacity > 0 ? `${hostel.occupancy}%` : '—' },
              { k: 'Onboarding', v: `${checklist.completed}/${checklist.total}` },
            ].map((m) => (
              <div key={m.k} className={`${ADMIN_CARD} px-3 py-[13px] text-center`}>
                <div className="font-admin text-[18px] font-extrabold text-[#221E1A]">{m.v}</div>
                <div className="mt-0.5 text-[10px] font-medium text-[#9A8F84]">{m.k}</div>
              </div>
            ))}
          </div>
          <DrawerSection title="Hostel details">
            <KeyValueRows
              rows={[
                { k: 'Address', v: hostel.address || '—' },
                { k: 'Phone', v: hostel.phone || '—' },
                { k: 'Verification', v: hostel.verification_status ?? '—' },
                { k: 'Listing', v: hostel.listing_status ?? '—' },
              ]}
            />
          </DrawerSection>
        </div>
      )}

      {activeTab === 'onboarding' && (
        <DrawerSection title={`Onboarding (${checklist.completed}/${checklist.total})`}>
          {checklist.items.map((item, index) => (
            <div key={item.id} className={`flex items-center justify-between px-[18px] py-3 ${index > 0 ? 'border-t border-[#F2ECE5]' : ''}`}>
              <span className="text-[12.5px] font-medium text-[#2A2521]">{item.label}</span>
              <span className={`text-[11.5px] font-bold ${item.done ? 'text-[#1F7A52]' : 'text-[#A2978B]'}`}>
                {item.done ? 'Done' : 'Pending'}
              </span>
            </div>
          ))}
        </DrawerSection>
      )}

      {activeTab === 'owner' && (
        <DrawerSection title="Owner">
          <KeyValueRows
            rows={[
              { k: 'Name', v: hostel.owner?.name || '—' },
              { k: 'Email', v: hostel.owner?.email || '—' },
              { k: 'Phone', v: hostel.owner?.phone || '—' },
            ]}
          />
        </DrawerSection>
      )}

      {activeTab === 'revenue' && (
        <DrawerSection title="Revenue">
          <KeyValueRows
            rows={[
              { k: 'This month', v: formatInr(Number(hostel.revenue ?? 0)) },
              { k: 'Outstanding dues', v: formatInr(Number(hostel.dues ?? 0)) },
              { k: 'Subscription', v: hostel.subscription?.status ?? 'Unassigned' },
            ]}
          />
        </DrawerSection>
      )}

      {(activeTab === 'rooms' || activeTab === 'tenants' || activeTab === 'food' || activeTab === 'support') && (
        <NotWiredYet title={`${tabs.find((t) => t.key === activeTab)?.label} — not available in this console yet`} />
      )}
    </div>
  );
}
