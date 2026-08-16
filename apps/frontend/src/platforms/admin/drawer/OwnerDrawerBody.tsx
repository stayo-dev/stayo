import { useQuery } from '@tanstack/react-query';
import { platformAdminService } from '@features/platform-admin/api';
import { DrawerSection, KeyValueRows } from './AdminDrawer';
import { formatInr } from '../owners/ownerRows';

const STATUS_COLOR: Record<string, string> = {
  LIVE: '#1F7A52',
  PENDING: '#B8792B',
  REJECTED: '#B3402F',
  SUSPENDED: '#B3402F',
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

/**
 * The owner detail drawer body. Every value here comes from
 * `/platform-admin/owners/[id]`; fields the endpoint does not return are
 * omitted entirely rather than rendered as an empty row, which would imply
 * the data exists and happens to be blank.
 */
export function OwnerDrawerBody({ ownerId }: { ownerId: string }) {
  const detail = useQuery({
    queryKey: ['admin', 'owner', ownerId],
    queryFn: () => platformAdminService.getOwner(ownerId),
    staleTime: 30_000,
  });

  if (detail.isLoading) {
    return <div className="py-12 text-center text-[13px] text-[#8A7F75]">Loading owner…</div>;
  }
  if (detail.isError || !detail.data) {
    return <div className="py-12 text-center text-[13px] text-[#B3402F]">Couldn't load this owner.</div>;
  }

  const { owner, hostels } = detail.data;

  const metrics = [
    { k: 'Hostels', v: String(owner.hostels ?? 0) },
    { k: 'Beds', v: String(owner.capacity ?? 0) },
    { k: 'Occupancy', v: owner.capacity > 0 ? `${owner.occupancy}%` : '—' },
    { k: 'Tenants', v: String(owner.active_tenants ?? 0) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-4 gap-2.5">
        {metrics.map((m) => (
          <div key={m.k} className="rounded-2xl border border-[#EFE6DA] bg-white px-3 py-[13px] text-center">
            <div className="font-admin text-[18px] font-extrabold text-[#221E1A]">{m.v}</div>
            <div className="mt-0.5 text-[10px] font-medium text-[#9A8F84]">{m.k}</div>
          </div>
        ))}
      </div>

      <DrawerSection title="Account & contact">
        <KeyValueRows
          rows={[
            { k: 'Email', v: owner.email || '—' },
            { k: 'Phone', v: owner.phone || '—' },
            { k: 'City', v: owner.city || '—' },
            { k: 'Joined', v: formatDate(owner.joined_at) },
            {
              k: 'Status',
              v: (
                <span className={owner.is_active ? 'text-[#1F7A52]' : 'text-[#B0A597]'}>
                  {owner.is_active ? 'Active' : 'Paused'}
                </span>
              ),
            },
          ]}
        />
      </DrawerSection>

      <DrawerSection title="This month">
        <KeyValueRows
          rows={[
            { k: 'Collected', v: formatInr(Number(owner.collected_this_month ?? 0)) },
            { k: 'Outstanding', v: formatInr(Number(owner.outstanding ?? 0)) },
          ]}
        />
      </DrawerSection>

      <DrawerSection title={`Hostels held (${hostels?.length ?? 0})`}>
        {(hostels ?? []).length === 0 ? (
          <div className="px-[18px] py-4 text-[12px] text-[#A2978B]">
            No hostels yet — this owner hasn't completed the add-hostel wizard.
          </div>
        ) : (
          (hostels ?? []).map((h: any, index: number) => (
            <div
              key={h.id}
              className={`flex items-center gap-3 px-[18px] py-[13px] ${
                index > 0 ? 'border-t border-[#F2ECE5]' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-[#2A2521]">{h.name}</div>
                <div className="truncate text-[11px] text-[#9A8F84]">
                  {[h.city, h.capacity ? `${h.capacity} beds` : null].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span
                className="flex-none text-[10px] font-semibold"
                style={{ color: STATUS_COLOR[String(h.listing_status)] ?? '#8A7F75' }}
              >
                {h.listing_status}
              </span>
            </div>
          ))
        )}
      </DrawerSection>
    </div>
  );
}
