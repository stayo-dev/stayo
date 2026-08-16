import { useState } from 'react';
import { Search } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { platformAdminService } from '@features/platform-admin/api';
import { DataTable, EmptyState, FilterChips, SegmentedTabs, StatCard, type DataColumn } from '../ui';
import { AdminDrawer } from '../drawer/AdminDrawer';
import { LeadDrawerBody } from '../drawer/LeadDrawerBody';
import { parseDetailParam, serializeDetail } from '../drawer/drawerParam';
import { STATUS_LABEL, STATUS_TONE } from '../leads/leadQueue';
import {
  stageChips, leadPipelineStats, formatLostReasons, nextStage, canAdvance,
  LOST_REASONS, LOST_REASON_LABEL,
} from '../leads/leadPipeline';
import { ADMIN_CARD, tintForId } from '../theme/palette';
import { useToast } from '../layout/toastContext';

const TONE_CLASS: Record<string, string> = {
  action: 'bg-[#FBF1DE] text-[#B8792B]',
  progress: 'bg-[#EAF0FB] text-[#3B5B9E]',
  done: 'bg-[#EAF3EE] text-[#1F7A52]',
  dead: 'bg-[#FBEFE9] text-[#B3402F]',
};

const COLUMNS: DataColumn[] = [
  { key: 'owner', label: 'Owner / hostel', width: '2fr' },
  { key: 'city', label: 'City', width: '1.2fr' },
  { key: 'beds', label: 'Beds', width: '0.8fr' },
  { key: 'stage', label: 'Stage', width: '1fr' },
  { key: 'age', label: 'Age', width: '0.8fr' },
];

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return '1d';
  return `${days}d`;
}

export function LeadsPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'insights' ? 'insights' : 'pipeline';
  const stage = params.get('stage') ?? 'all';
  const detail = parseDetailParam(params.get('detail'));
  const queryClient = useQueryClient();
  const fireToast = useToast();
  const [lostFor, setLostFor] = useState<string | null>(null);

  const search = params.get('search') ?? '';

  const leads = useQuery({
    queryKey: ['admin', 'leads', stage, search],
    queryFn: () =>
      platformAdminService.getLeads({
        status: stage === 'all' ? undefined : stage,
        search: search || undefined,
        limit: 100,
      }),
    staleTime: 30_000,
  });
  const allCounts = useQuery({
    queryKey: ['admin', 'leads', 'counts'],
    queryFn: () => platformAdminService.getLeads({ limit: 1 }),
    staleTime: 30_000,
  });
  const insights = useQuery({
    queryKey: ['admin', 'leads', 'insights'],
    queryFn: () => platformAdminService.getLeadInsights(),
    enabled: view === 'insights',
    staleTime: 60_000,
  });

  const counts = allCounts.data?.counts ?? {};
  const rows = (leads.data?.leads ?? []).map((l: any) => ({ ...l, id: String(l.id) }));

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value == null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'leads'] });

  const openLead = detail?.kind === 'lead' ? rows.find((r: any) => r.id === detail.id) : undefined;

  const advance = async (lead: any) => {
    const to = nextStage(lead.status);
    if (!to) return;
    try {
      await platformAdminService.updateLeadStatus(lead.id, to);
      refresh();
      queryClient.invalidateQueries({ queryKey: ['admin', 'lead', lead.id] });
      fireToast(`Moved to ${STATUS_LABEL[to] ?? to}`);
    } catch {
      fireToast('Could not move that lead', 'no');
    }
  };

  const markLost = async (leadId: string, reason: string) => {
    try {
      await platformAdminService.markLeadLost(leadId, reason);
      setLostFor(null);
      refresh();
      queryClient.invalidateQueries({ queryKey: ['admin', 'lead', leadId] });
      fireToast('Lead marked lost', 'no');
    } catch {
      fireToast('Could not mark that lead lost', 'no');
    }
  };

  const approve = async (lead: any) => {
    try {
      const result = await platformAdminService.approveLead(lead.id);
      refresh();
      fireToast(
        result?.whatsapp_sent || result?.email_sent
          ? 'Approved — activation link sent'
          : 'Approved, but the invite could not be delivered',
        result?.whatsapp_sent || result?.email_sent ? 'ok' : 'no',
      );
    } catch {
      fireToast('Could not approve that lead', 'no');
    }
  };

  return (
    <div className="flex animate-[adFade_.25s_ease] flex-col gap-5">
      <SegmentedTabs
        tabs={[
          { key: 'pipeline', label: 'Pipeline' },
          { key: 'insights', label: 'Feedback & insights' },
        ]}
        active={view}
        onChange={(k) => setParam('view', k === 'pipeline' ? null : k)}
      />

      {view === 'pipeline' ? (
        <>
          <div className="grid grid-cols-2 gap-[13px] lg:grid-cols-4">
            {leadPipelineStats(counts).map((s) => (
              <StatCard
                key={s.key}
                label={s.label}
                value={s.value}
                sub={s.sub}
                valueTone={(s.tone as any) ?? 'ink'}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <FilterChips
              chips={stageChips(counts)}
              active={stage}
              onChange={(k) => setParam('stage', k === 'all' ? null : k)}
            />
            <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-xl border border-[#EAE1D8] bg-white px-3.5 py-2 sm:max-w-[320px]">
              <Search className="h-3.5 w-3.5 flex-none text-[#988D82]" />
              <input
                value={search}
                onChange={(e) => setParam('search', e.target.value || null)}
                placeholder="Search by name, hostel, city or phone…"
                className="w-full min-w-0 border-none bg-transparent text-[12.5px] text-[#2A2521] outline-none"
              />
            </div>
          </div>

          {leads.isLoading ? (
            <div className="py-16 text-center text-[13px] text-[#8A7F75]">Loading leads…</div>
          ) : (
            <DataTable
              columns={COLUMNS}
              rows={rows}
              onRowClick={(r: any) => setParam('detail', serializeDetail({ kind: 'lead', id: r.id }))}
              empty={
                <EmptyState
                  title={stage === 'all' ? 'No leads yet' : 'Nothing at this stage'}
                  message="Owner sign-ups from the landing page appear here."
                />
              }
              renderCell={(r: any, key) => {
                if (key === 'owner') {
                  return (
                    <div className="flex min-w-0 items-center gap-[11px]">
                      <span
                        className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] font-admin text-[12px] font-bold text-white"
                        style={{ background: tintForId(r.id) }}
                      >
                        {(r.name ?? '?').slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold text-[#2A2521]">{r.name}</div>
                        <div className="truncate text-[11px] text-[#9A8F84]">{r.hostel_name}</div>
                      </div>
                    </div>
                  );
                }
                if (key === 'city') return <span className="text-[12.5px] text-[#5A5147]">{r.city || '—'}</span>;
                if (key === 'beds') {
                  return (
                    <span className="font-admin text-[13px] font-bold text-[#221E1A]">
                      {r.qual_beds ?? r.bed_count ?? '—'}
                    </span>
                  );
                }
                if (key === 'stage') {
                  return (
                    <span
                      className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        TONE_CLASS[STATUS_TONE[r.status] ?? 'action']
                      }`}
                    >
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  );
                }
                return <span className="text-[11.5px] text-[#9A8F84]">{timeAgo(r.created_at)}</span>;
              }}
            />
          )}
        </>
      ) : (
        <InsightsTab data={insights.data} isLoading={insights.isLoading} />
      )}

      {detail?.kind === 'lead' && openLead && (
        <AdminDrawer
          title={openLead.name}
          subtitle={[openLead.hostel_name, openLead.city].filter(Boolean).join(' · ')}
          initials={(openLead.name ?? '?').slice(0, 2).toUpperCase()}
          tint={tintForId(openLead.id)}
          onClose={() => setParam('detail', null)}
          footer={
            lostFor === openLead.id ? (
              <div>
                <div className="mb-2 font-admin text-[12px] font-bold text-[#221E1A]">
                  Why is this lead lost?
                </div>
                <div className="mb-2.5 flex flex-wrap gap-1.5">
                  {LOST_REASONS.map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => markLost(openLead.id, reason)}
                      className="rounded-full border border-[#E7DDD1] bg-white px-3 py-2 text-[11.5px] font-semibold text-[#5A5147] hover:border-[#B3402F] hover:text-[#B3402F]"
                    >
                      {LOST_REASON_LABEL[reason]}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setLostFor(null)}
                  className="w-full rounded-xl border border-[#E9DFD3] bg-white py-2.5 font-admin text-[13px] font-bold text-[#5A5147]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                {openLead.status !== 'LOST' && (
                  <button
                    type="button"
                    onClick={() => setLostFor(openLead.id)}
                    className="flex-1 rounded-xl border border-[#E6C7BF] bg-[#FBEFE9] py-3 font-admin text-[13.5px] font-bold text-[#B3402F]"
                  >
                    Mark lost
                  </button>
                )}
                {canAdvance(openLead.status) ? (
                  <button
                    type="button"
                    onClick={() => advance(openLead)}
                    className="flex-[1.4] rounded-xl bg-[#B46A55] py-3 font-admin text-[13.5px] font-bold text-white shadow-[0_4px_14px_rgba(180,106,85,.3)]"
                  >
                    Move to {STATUS_LABEL[nextStage(openLead.status) as string]}
                  </button>
                ) : openLead.status === 'NEGOTIATING' ? (
                  <button
                    type="button"
                    onClick={() => approve(openLead)}
                    className="flex-[1.4] rounded-xl bg-[#1F7A52] py-3 font-admin text-[13.5px] font-bold text-white shadow-[0_4px_14px_rgba(31,122,82,.3)]"
                  >
                    Approve &amp; send invite
                  </button>
                ) : null}
              </div>
            )
          }
        >
          <LeadDrawerBody leadId={openLead.id} />
        </AdminDrawer>
      )}
    </div>
  );
}

function InsightsTab({ data, isLoading }: { data: any; isLoading: boolean }) {
  if (isLoading) {
    return <div className="py-16 text-center text-[13px] text-[#8A7F75]">Loading insights…</div>;
  }
  if (!data) {
    return <EmptyState title="No insights yet" message="Insights appear once leads have been worked." />;
  }

  const lostRows = formatLostReasons(data.lost_reasons ?? []);
  const t = data.totals ?? {};

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-[13px] lg:grid-cols-4">
        <StatCard label="Leads captured" value={String(t.total_leads ?? 0)} sub="all time" />
        <StatCard label="Converted" value={String(t.live ?? 0)} sub="now on the platform" valueTone="green" />
        <StatCard label="Lost" value={String(t.lost ?? 0)} sub={t.loss_pct != null ? `${t.loss_pct}% of all leads` : '—'} valueTone="red" />
        <StatCard label="With discovery notes" value={String(t.with_discovery ?? 0)} sub="captured on a call" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className={`${ADMIN_CARD} px-[22px] py-5`}>
          <div className="font-admin text-[15px] font-bold tracking-[-0.01em] text-[#221E1A]">
            Why leads are lost
          </div>
          <div className="mt-0.5 text-[12px] text-[#8A7F75]">Fix these to win next time</div>
          <div className="mt-4 flex flex-col gap-3">
            {lostRows.length === 0 ? (
              <div className="py-6 text-center text-[12px] text-[#A2978B]">
                No lost leads have a recorded reason yet.
              </div>
            ) : (
              lostRows.map((r) => (
                <div key={r.reason}>
                  <div className="mb-1.5 flex justify-between">
                    <span className="text-[12px] font-semibold text-[#4A433C]">{r.label}</span>
                    <span className="font-admin text-[12px] font-bold text-[#221E1A]">{r.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#F0EAE2]">
                    <div className="h-full rounded-full bg-[#B3402F]" style={{ width: r.width }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={`${ADMIN_CARD} px-[22px] py-5`}>
          <div className="font-admin text-[15px] font-bold tracking-[-0.01em] text-[#221E1A]">
            What they use today
          </div>
          <div className="mt-0.5 text-[12px] text-[#8A7F75]">
            Free text from discovery — counted loosely, not a survey
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {(data.tooling ?? []).length === 0 ? (
              <div className="py-6 text-center text-[12px] text-[#A2978B]">
                Nothing captured yet.
              </div>
            ) : (
              (data.tooling ?? []).map((t2: any) => (
                <span
                  key={t2.label}
                  className="rounded-[9px] bg-[#F5EFE8] px-3 py-2 text-[11.5px] font-semibold capitalize text-[#6E6459]"
                >
                  {t2.label} · {t2.count}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      <div className={`${ADMIN_CARD} px-[22px] py-5`}>
        <div className="font-admin text-[15px] font-bold tracking-[-0.01em] text-[#221E1A]">
          Recent discovery notes
        </div>
        <div className="mt-2 flex flex-col">
          {(data.discovery ?? []).length === 0 ? (
            <div className="py-8 text-center text-[12px] text-[#A2978B]">
              Discovery answers captured in the lead drawer appear here.
            </div>
          ) : (
            (data.discovery ?? []).map((d: any, i: number) => (
              <div key={d.id} className={`flex gap-3.5 py-3.5 ${i > 0 ? 'border-t border-[#F2ECE5]' : ''}`}>
                <span
                  className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] font-admin text-[12px] font-bold text-white"
                  style={{ background: tintForId(d.id) }}
                >
                  {(d.name ?? '?').slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] leading-relaxed text-[#2A2521]">
                    “{d.discovery_problem || d.discovery_why || d.discovery_expect}”
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#9A8F84]">
                    {[d.name, d.hostel_name, d.city].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
