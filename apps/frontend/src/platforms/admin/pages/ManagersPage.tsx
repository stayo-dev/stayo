import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Search, Plus } from 'lucide-react';
import { platformAdminService } from '@features/platform-admin/api';
import { Avatar, DataTable, EmptyState, FilterChips, StatCard, type DataColumn } from '../ui';
import { toManagerRows, managerStats, STATUS_LABEL, STATUS_TONE, type ManagerRow } from '../managers/managerRows';
import { parseDetailParam, serializeDetail } from '../drawer/drawerParam';
import { AdminDrawer } from '../drawer/AdminDrawer';
import { ManagerDrawerBody } from '../drawer/ManagerDrawerBody';
import { AddManagerDrawer } from '../managers/AddManagerDrawer';

const TONE_COLOR: Record<string, string> = { green: '#1F7A52', amber: '#B8792B', red: '#B3402F' };

const COLUMNS: DataColumn[] = [
  { key: 'manager', label: 'Manager', width: '2fr' },
  { key: 'status', label: 'Status', width: '1fr' },
  { key: 'permissions', label: 'Permissions', width: '1.4fr' },
  { key: 'hostels', label: 'Hostels', width: '0.8fr' },
];

/**
 * Super Admin's Managers console (ADR-212) — list + URL-addressable detail
 * drawer, mirroring OwnersPage's pattern exactly. ADMIN-only route (see
 * adminNav.ts — this item never renders for a MANAGER session), and every
 * mutation the drawer performs is independently re-checked ADMIN-only
 * server-side regardless of what this page shows.
 */
export function ManagersPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const status = params.get('status') ?? 'all';
  const detail = parseDetailParam(params.get('detail'));
  const [addManagerOpen, setAddManagerOpen] = useState(false);

  const managers = useQuery({
    queryKey: ['admin', 'managers', search, status],
    queryFn: () => platformAdminService.getManagers({ search: search || undefined, status: status === 'all' ? undefined : status }),
    staleTime: 15_000,
  });

  const rows = toManagerRows(managers.data ?? []);

  const openManager = (row: ManagerRow) => {
    const next = new URLSearchParams(params);
    next.set('detail', serializeDetail({ kind: 'manager', id: row.id }));
    setParams(next, { replace: false });
  };

  const closeDrawer = () => {
    const next = new URLSearchParams(params);
    next.delete('detail');
    setParams(next, { replace: true });
  };

  const setStatusFilter = (key: string) => {
    const next = new URLSearchParams(params);
    if (key === 'all') next.delete('status');
    else next.set('status', key);
    setParams(next, { replace: true });
  };

  const openRow = detail?.kind === 'manager' ? rows.find((r) => r.id === detail.id) : undefined;

  return (
    <div className="flex animate-[adFade_.25s_ease] flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-border bg-white px-[15px] py-[11px] sm:max-w-[420px]">
          <Search className="h-4 w-4 flex-none text-[#988D82]" />
          <input
            value={search}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set('search', e.target.value);
              else next.delete('search');
              setParams(next, { replace: true });
            }}
            placeholder="Search managers…"
            className="w-full min-w-0 border-none bg-transparent text-[13px] text-[#2A2521] outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => setAddManagerOpen(true)}
          className="flex flex-none items-center gap-1.5 rounded-xl bg-[#221E1A] px-4 py-[11px] font-admin text-[12.5px] font-bold text-white"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          <span className="hidden sm:inline">Add Manager</span>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-[13px] lg:grid-cols-4">
        {managerStats(rows).map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} sub={s.sub} />
        ))}
      </div>

      <FilterChips
        chips={[
          { key: 'all', label: 'All' },
          { key: 'ACTIVE', label: 'Active' },
          { key: 'PENDING_INVITATION', label: 'Pending' },
          { key: 'SUSPENDED', label: 'Suspended' },
        ]}
        active={status}
        onChange={setStatusFilter}
      />

      {managers.isLoading ? (
        <div className="py-16 text-center text-[13px] text-[#8A7F75]">Loading managers…</div>
      ) : managers.isError ? (
        <EmptyState title="Couldn't load managers" message="The request failed. Refresh to try again." />
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          onRowClick={openManager}
          empty={
            <EmptyState
              title={search ? 'No matches' : 'No managers yet'}
              message={search ? 'Try a different search.' : 'Add a manager to delegate work below Super Admin.'}
            />
          }
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2.5">
                <Avatar initials={row.initials} tint={row.tint} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-[#2A2521]">{row.name}</div>
                  <div className="truncate text-[11px] text-[#9A8F84]">{row.email}</div>
                </div>
                <span className="flex-none text-[10.5px] font-bold" style={{ color: TONE_COLOR[STATUS_TONE[row.status]] }}>
                  {STATUS_LABEL[row.status]}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {row.permissions.length === 0 ? (
                  <span className="text-[11px] text-[#A2978B]">No permissions</span>
                ) : (
                  <span className="text-[11px] text-[#8A7F75]">{row.permissions.length} permission{row.permissions.length === 1 ? '' : 's'}</span>
                )}
                <span className="text-[11px] text-[#8A7F75]">· {row.hostelCount} hostel{row.hostelCount === 1 ? '' : 's'}</span>
              </div>
            </div>
          )}
          renderCell={(row, key) => {
            switch (key) {
              case 'manager':
                return (
                  <div className="flex items-center gap-2.5">
                    <Avatar initials={row.initials} tint={row.tint} size={32} />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-[#2A2521]">{row.name}</div>
                      <div className="truncate text-[11px] text-[#9A8F84]">{row.email}</div>
                    </div>
                  </div>
                );
              case 'status':
                return (
                  <span className="text-[12px] font-bold" style={{ color: TONE_COLOR[STATUS_TONE[row.status]] }}>
                    {STATUS_LABEL[row.status]}
                  </span>
                );
              case 'permissions':
                return (
                  <span className="text-[12px] text-[#5A5147]">
                    {row.permissions.length === 0 ? '—' : `${row.permissions.length} granted`}
                  </span>
                );
              case 'hostels':
                return <span className="text-[12px] font-semibold text-[#2A2521]">{row.hostelCount}</span>;
              default:
                return null;
            }
          }}
        />
      )}

      {detail?.kind === 'manager' && (
        <AdminDrawer
          title={openRow?.name ?? 'Manager'}
          subtitle={openRow?.email}
          initials={openRow?.initials ?? '—'}
          tint={openRow?.tint}
          onClose={closeDrawer}
        >
          <ManagerDrawerBody managerId={detail.id} />
        </AdminDrawer>
      )}

      {addManagerOpen && <AddManagerDrawer onClose={() => setAddManagerOpen(false)} />}
    </div>
  );
}
