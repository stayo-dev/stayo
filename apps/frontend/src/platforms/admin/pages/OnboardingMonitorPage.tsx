import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { platformAdminService } from '@features/platform-admin/api';
import { DataTable, EmptyState, FilterChips, type DataColumn } from '../ui';
import { toManagerRows } from '../managers/managerRows';
import { computeOnboardingChecklist } from '../onboarding/onboardingChecklist';

const COLUMNS: DataColumn[] = [
  { key: 'hostel', label: 'Hostel', width: '2fr' },
  { key: 'manager', label: 'Assigned manager', width: '1.4fr' },
  { key: 'progress', label: 'Onboarding', width: '1.2fr' },
  { key: 'status', label: 'Status', width: '1fr' },
];

/**
 * Super Admin's onboarding-progress-by-hostel view (spec §10, ADR-212).
 * Progress is derived (`onboardingChecklist.ts`), not a stored wizard-step
 * table. "Assigned manager" is resolved client-side from each manager's own
 * active hostel assignments — there is no separate hostel->manager lookup
 * endpoint, and building one would duplicate what `GET /platform-admin/managers`
 * already returns.
 */
export function OnboardingMonitorPage() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [managerFilter, setManagerFilter] = useState('all');

  const hostels = useQuery({
    queryKey: ['admin', 'hostels', 'onboarding-monitor'],
    queryFn: () => platformAdminService.getHostels(),
    staleTime: 30_000,
  });
  const managers = useQuery({
    queryKey: ['admin', 'managers', 'onboarding-monitor'],
    queryFn: () => platformAdminService.getManagers(),
    staleTime: 30_000,
  });
  const managerRows = toManagerRows(managers.data ?? []);

  const managerByHostelId = new Map<string, { id: string; name: string }>();
  for (const m of managerRows) {
    for (const hostelId of m.hostelIds) managerByHostelId.set(hostelId, { id: m.id, name: m.name });
  }

  type Row = {
    id: string;
    name: string;
    city: string;
    managerName: string;
    managerId: string | null;
    completed: number;
    total: number;
    status: 'complete' | 'in_progress';
    /** Labels of the checklist items still outstanding — surfaced directly in
     *  the table so "6/7" answers "which thing is left" without a click. */
    missingLabels: string[];
  };

  const rows: Row[] = (hostels.data ?? [])
    // Stayo-authored marketplace-coverage listings (`listing_source:
    // PLATFORM_LISTED`, created via "List a hostel on Stayo") have no real
    // owner running them — nobody will ever add rooms, tenants or a
    // subscription for one, so every one of them sits at a permanent,
    // meaningless "0/7, missing everything." Onboarding tracks a real
    // owner's operational setup; a platform listing's own progress (does it
    // have a written marketing page yet) belongs in Hostel Listings ->
    // Stayo-listed, where that work actually happens.
    .filter((h: any) => h.listing_source !== 'PLATFORM_LISTED')
    .map((h: any) => {
      const checklist = computeOnboardingChecklist({
        verification_status: h.verification_status ?? null,
        listing_status: h.listing_status ?? null,
        rooms: Number(h.rooms ?? 0),
        capacity: Number(h.capacity ?? 0),
        tenants: Number(h.tenants ?? 0),
        revenue: Number(h.revenue ?? 0),
        subscription_status: h.subscription_status ?? null,
      });
      const manager = managerByHostelId.get(String(h.id));
      return {
        id: String(h.id),
        name: h.name,
        city: h.city ?? '—',
        managerName: manager?.name ?? 'Unassigned',
        managerId: manager?.id ?? null,
        completed: checklist.completed,
        total: checklist.total,
        status: checklist.status,
        missingLabels: checklist.items.filter((i) => !i.done).map((i) => i.label),
      };
    });

  const filtered = rows.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (managerFilter === 'unassigned' && r.managerId) return false;
    if (managerFilter !== 'all' && managerFilter !== 'unassigned' && r.managerId !== managerFilter) return false;
    return true;
  });

  const isLoading = hostels.isLoading || managers.isLoading;

  return (
    <div className="flex animate-[adFade_.25s_ease] flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <FilterChips
          chips={[
            { key: 'all', label: 'All' },
            { key: 'in_progress', label: 'In progress' },
            { key: 'complete', label: 'Complete' },
          ]}
          active={statusFilter}
          onChange={setStatusFilter}
        />
        <select
          className="rounded-xl border border-border bg-white px-3 py-2 text-[12.5px] font-semibold text-[#2A2521] outline-none"
          value={managerFilter}
          onChange={(e) => setManagerFilter(e.target.value)}
        >
          <option value="all">All managers</option>
          <option value="unassigned">Unassigned</option>
          {managerRows.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-[13px] text-[#8A7F75]">Loading hostels…</div>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={filtered}
          empty={<EmptyState title="No hostels match" message="Try a different filter." />}
          renderCell={(row, key) => {
            switch (key) {
              case 'hostel':
                return (
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-[#2A2521]">{row.name}</div>
                    <div className="truncate text-[11px] text-[#9A8F84]">{row.city}</div>
                  </div>
                );
              case 'manager':
                return (
                  <span className={row.managerId ? 'text-[12.5px] font-semibold text-[#2A2521]' : 'text-[12.5px] text-[#A2978B]'}>
                    {row.managerName}
                  </span>
                );
              case 'progress':
                return (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[#F2ECE5]">
                      <div
                        className="h-full rounded-full bg-[#B46A55]"
                        style={{ width: `${row.total > 0 ? (row.completed / row.total) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="text-[12px] font-semibold text-[#5A5147]">
                      {row.completed}/{row.total}
                    </span>
                  </div>
                );
              case 'status':
                return (
                  <div>
                    <span
                      className="text-[11.5px] font-bold"
                      style={{ color: row.status === 'complete' ? '#1F7A52' : '#B8792B' }}
                    >
                      {row.status === 'complete' ? 'Complete' : 'In Progress'}
                    </span>
                    {row.missingLabels.length > 0 && (
                      // max-w caps how wide this text is allowed to claim —
                      // without it, a hostel missing every check produces one
                      // long unbroken string ("Missing: Platform verified,
                      // Rooms created, Beds configured, ...") whose natural
                      // (unwrapped) width becomes the table's own minimum
                      // width, since DataTable sizes itself to fit its
                      // widest content (`min-w-max`). That pushed the whole
                      // table wider than the screen, shoving every other
                      // column off to the right behind a scrollbar. Capping
                      // the width forces it to wrap onto a couple of lines
                      // instead of stretching the table.
                      <div className="mt-0.5 max-w-[200px] text-[10.5px] leading-snug text-[#9A8F84]">
                        Missing: {row.missingLabels.join(', ')}
                      </div>
                    )}
                  </div>
                );
              default:
                return null;
            }
          }}
        />
      )}
    </div>
  );
}
