import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { platformAdminService } from '@features/platform-admin/api';
import { DataTable, EmptyState, StatCard, type DataColumn } from '../ui';
import { toOwnerRows, ownerStats, type OwnerRow } from '../owners/ownerRows';
import { parseDetailParam, serializeDetail } from '../drawer/drawerParam';
import { AdminDrawer } from '../drawer/AdminDrawer';
import { OwnerDrawerBody } from '../drawer/OwnerDrawerBody';

const COLUMNS: DataColumn[] = [
  { key: 'owner', label: 'Owner', width: '2fr' },
  { key: 'hostels', label: 'Hostels', width: '0.9fr' },
  { key: 'beds', label: 'Beds', width: '1fr' },
  { key: 'gmv', label: 'Monthly GMV', width: '1.1fr' },
  { key: 'plan', label: 'Plan', width: '1fr' },
  { key: 'status', label: 'Status', width: '0.9fr' },
];

export function OwnersPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const detail = parseDetailParam(params.get('detail'));

  const owners = useQuery({
    queryKey: ['admin', 'owners', search],
    queryFn: () => platformAdminService.getOwners({ search: search || undefined }),
    staleTime: 30_000,
  });

  const rows = toOwnerRows(owners.data?.owners ?? []);

  const openOwner = (row: OwnerRow) => {
    const next = new URLSearchParams(params);
    next.set('detail', serializeDetail({ kind: 'owner', id: row.id }));
    setParams(next, { replace: false });
  };

  const closeDrawer = () => {
    const next = new URLSearchParams(params);
    next.delete('detail');
    setParams(next, { replace: true });
  };

  const openRow = detail?.kind === 'owner' ? rows.find((r) => r.id === detail.id) : undefined;

  return (
    <div className="flex animate-[adFade_.25s_ease] flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-[#EAE1D8] bg-white px-[15px] py-[11px] sm:max-w-[420px]">
          <Search className="h-4 w-4 flex-none text-[#988D82]" />
          <input
            value={search}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set('search', e.target.value);
              else next.delete('search');
              setParams(next, { replace: true });
            }}
            placeholder="Search by owner, phone, email, hostel or city…"
            className="w-full min-w-0 border-none bg-transparent text-[13px] text-[#2A2521] outline-none"
          />
        </div>
        {owners.data ? (
          <span className="hidden text-[12px] font-medium text-[#9A8F84] sm:block">
            Showing {rows.length} of {owners.data.total}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-[13px] lg:grid-cols-4">
        {ownerStats(rows).map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} sub={s.sub} />
        ))}
      </div>

      {owners.isLoading ? (
        <div className="py-16 text-center text-[13px] text-[#8A7F75]">Loading owners…</div>
      ) : owners.isError ? (
        <EmptyState title="Couldn't load owners" message="The request failed. Refresh to try again." />
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          onRowClick={openOwner}
          empty={
            <EmptyState
              title={search ? 'No matches' : 'No owners yet'}
              message={
                search
                  ? 'Try a different search term.'
                  : 'Owners appear here once a lead activates their account.'
              }
            />
          }
          renderCell={(row, key) => {
            if (key === 'owner') {
              return (
                <div className="flex min-w-0 items-center gap-[11px]">
                  <span
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-full font-admin text-[12px] font-bold text-white"
                    style={{ background: row.tint }}
                  >
                    {row.initials}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-[#2A2521]">{row.name}</div>
                    <div className="truncate text-[11px] text-[#9A8F84]">{row.city}</div>
                  </div>
                </div>
              );
            }
            if (key === 'hostels') return <span className="font-admin text-[13px] font-bold text-[#221E1A]">{row.hostels}</span>;
            if (key === 'beds') return <span className="text-[12.5px] font-medium text-[#5A5147]">{row.beds}</span>;
            if (key === 'gmv') return <span className="font-admin text-[13px] font-bold text-[#221E1A]">{row.gmv}</span>;
            if (key === 'plan') {
              return (
                <span className="rounded-md bg-[#F5E9E3] px-2.5 py-[3px] text-[11px] font-semibold text-[#B46A55]">
                  {row.plan}
                </span>
              );
            }
            return (
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`h-[7px] w-[7px] rounded-full ${
                    row.statusTone === 'green' ? 'bg-[#1F7A52]' : 'bg-[#B0A597]'
                  }`}
                />
                <span className="text-[12px] font-medium text-[#5A5147]">{row.status}</span>
              </span>
            );
          }}
        />
      )}

      {detail?.kind === 'owner' && (
        <AdminDrawer
          title={openRow?.name ?? 'Owner'}
          subtitle={openRow?.city}
          initials={openRow?.initials ?? '—'}
          tint={openRow?.tint}
          radius="rounded-full"
          onClose={closeDrawer}
        >
          <OwnerDrawerBody ownerId={detail.id} />
        </AdminDrawer>
      )}
    </div>
  );
}
