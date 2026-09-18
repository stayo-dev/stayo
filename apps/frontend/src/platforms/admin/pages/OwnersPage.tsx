import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Search, Plus } from 'lucide-react';
import { platformAdminService } from '@features/platform-admin/api';
import { Avatar, DataTable, EmptyState, StatCard, type DataColumn } from '../ui';
import { toOwnerRows, ownerStats, type OwnerRow } from '../owners/ownerRows';
import { parseDetailParam, serializeDetail } from '../drawer/drawerParam';
import { AdminDrawer } from '../drawer/AdminDrawer';
import { OwnerDrawerBody } from '../drawer/OwnerDrawerBody';
import { AddOwnerDrawer } from '../owners/AddOwnerDrawer';
import { LeadPipelineDrawer } from '../leads/LeadPipelineDrawer';
import { STATUS_LABEL } from '../leads/leadQueue';

const PENDING_STATUSES = ['NEW', 'UNDER_REVIEW', 'CONTACTED', 'DEMO', 'NEGOTIATING', 'APPROVED', 'INVITE_SENT'];

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
  const [addOwnerOpen, setAddOwnerOpen] = useState(false);

  const owners = useQuery({
    queryKey: ['admin', 'owners', search],
    queryFn: () => platformAdminService.getOwners({ search: search || undefined }),
    staleTime: 30_000,
  });

  // Admin-added owners who haven't completed real signup yet have no
  // `profile` row (see docs/obsidian/Features.md, Admin -> Add Owner) so
  // they can't appear in the query above — they're surfaced here instead,
  // straight from the existing leads endpoint, filtered client-side to the
  // pre-activation statuses. No new status model: PlatformLeadStatus labels
  // (leadQueue.ts) are reused as-is.
  const pendingOwners = useQuery({
    queryKey: ['admin', 'leads', 'source', 'DIRECT_ADMIN'],
    queryFn: () => platformAdminService.getLeads({ source: 'DIRECT_ADMIN', limit: 100 }),
    staleTime: 15_000,
  });
  const pendingRows = (pendingOwners.data?.leads ?? []).filter((l: any) => PENDING_STATUSES.includes(l.status));

  const rows = toOwnerRows(owners.data?.owners ?? []);

  const openOwner = (row: OwnerRow) => {
    const next = new URLSearchParams(params);
    next.set('detail', serializeDetail({ kind: 'owner', id: row.id }));
    setParams(next, { replace: false });
  };

  const openPendingLead = (leadId: string) => {
    const next = new URLSearchParams(params);
    next.set('detail', serializeDetail({ kind: 'lead', id: leadId }));
    setParams(next, { replace: false });
  };

  const closeDrawer = () => {
    const next = new URLSearchParams(params);
    next.delete('detail');
    setParams(next, { replace: true });
  };

  const openRow = detail?.kind === 'owner' ? rows.find((r) => r.id === detail.id) : undefined;
  const openLead = detail?.kind === 'lead' ? pendingRows.find((l: any) => l.id === detail.id) : undefined;

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
            placeholder="Search by owner, phone, email, hostel or city…"
            className="w-full min-w-0 border-none bg-transparent text-[13px] text-[#2A2521] outline-none"
          />
        </div>
        {owners.data ? (
          <span className="hidden text-[12px] font-medium text-[#9A8F84] sm:block">
            Showing {rows.length} of {owners.data.total}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setAddOwnerOpen(true)}
          className="flex flex-none items-center gap-1.5 rounded-xl bg-[#221E1A] px-4 py-[11px] font-admin text-[12.5px] font-bold text-white"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          <span className="hidden sm:inline">Add Owner</span>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-[13px] lg:grid-cols-4">
        {ownerStats(rows).map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} sub={s.sub} />
        ))}
      </div>

      {pendingRows.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-[#EFE6DA] bg-white">
          <div className="border-b border-[#F2ECE5] px-[18px] py-[13px]">
            <span className="text-[11px] font-bold uppercase tracking-[.06em] text-[#A2978B]">
              Pending onboarding · Added directly
            </span>
          </div>
          {pendingRows.map((lead: any, index: number) => (
            // Opens the same lead drawer/actions the Leads page uses (approve
            // / advance / mark lost), inline on this page — Add Owner is a
            // manual onboarding action, a different thing from the Leads
            // screen's marketing pipeline, so this never navigates there.
            // Before this, a lead created here but not carried through to
            // "Send onboarding link" in one sitting had no way back in: this
            // row rendered but did nothing on click.
            <button
              key={lead.id}
              type="button"
              onClick={() => openPendingLead(lead.id)}
              className={`flex w-full items-center justify-between gap-3 px-[18px] py-3 text-left hover:bg-[#FCFAF7] ${
                index > 0 ? 'border-t border-[#F2ECE5]' : ''
              }`}
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-[#2A2521]">{lead.name}</div>
                <div className="truncate text-[11px] text-[#9A8F84]">{lead.phone}</div>
              </div>
              <span className="flex flex-none items-center gap-2">
                <span className="rounded-md bg-[#F5EFE7] px-2.5 py-[3px] text-[11px] font-semibold text-[#8A7F75]">
                  {STATUS_LABEL[lead.status] ?? lead.status}
                </span>
                <span className="text-[12px] font-semibold text-[#B46A55]">Continue ›</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {owners.isLoading ? (
        <div className="py-16 text-center text-[13px] text-[#8A7F75]">Loading owners…</div>
      ) : owners.isError ? (
        <EmptyState title="Couldn't load owners" message="The request failed. Refresh to try again." />
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          onRowClick={openOwner}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-2">
              <div className="flex min-w-0 items-center gap-[11px]">
                <Avatar photoUrl={row.photoUrl} initials={row.initials} tint={row.tint} size={36} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-[#2A2521]">{row.name}</div>
                  <div className="truncate text-[11px] text-[#9A8F84]">{row.city}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[12px] font-medium text-[#5A5147]">
                <span>{row.hostels} {row.hostels === 1 ? 'hostel' : 'hostels'}</span>
                <span className="text-[#D8CFC3]">·</span>
                <span>{row.beds} beds</span>
                <span className="text-[#D8CFC3]">·</span>
                <span className="font-admin font-bold text-[#221E1A]">{row.gmv}/mo</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-[#F5E9E3] px-2.5 py-[3px] text-[11px] font-semibold text-[#B46A55]">
                  {row.plan}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`h-[7px] w-[7px] rounded-full ${
                      row.statusTone === 'green' ? 'bg-[#1F7A52]' : 'bg-[#B0A597]'
                    }`}
                  />
                  <span className="text-[12px] font-medium text-[#5A5147]">{row.status}</span>
                </span>
              </div>
            </div>
          )}
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
                  <Avatar photoUrl={row.photoUrl} initials={row.initials} tint={row.tint} size={36} />
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
          photoUrl={openRow?.photoUrl}
          radius="rounded-full"
          onClose={closeDrawer}
        >
          <OwnerDrawerBody ownerId={detail.id} />
        </AdminDrawer>
      )}

      {detail?.kind === 'lead' && openLead && (
        <LeadPipelineDrawer lead={openLead} onClose={closeDrawer} />
      )}

      {addOwnerOpen && (
        <AddOwnerDrawer
          onClose={() => {
            setAddOwnerOpen(false);
            pendingOwners.refetch();
          }}
        />
      )}
    </div>
  );
}
