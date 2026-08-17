import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Info, Copy, AlertTriangle } from 'lucide-react';
import { platformAdminService } from '@features/platform-admin/api';
import { ADMIN_CARD, tintForId } from '../theme/palette';
import { EmptyState, SegmentedTabs, StatCard, NotWiredYet } from '../ui';
import { AdminDrawer, DrawerSection, KeyValueRows } from '../drawer/AdminDrawer';
import { parseDetailParam, serializeDetail } from '../drawer/drawerParam';
import { useToast } from '../layout/toastContext';
import { formatInr } from '../owners/ownerRows';

const PAYOUT_METHODS = ['BANK_TRANSFER', 'UPI', 'IMPS', 'NEFT', 'RTGS'] as const;
const METHOD_LABEL: Record<string, string> = {
  BANK_TRANSFER: 'Bank transfer', UPI: 'UPI', IMPS: 'IMPS', NEFT: 'NEFT', RTGS: 'RTGS',
};

const LANES = [
  { key: 'pending', title: 'To pay', dot: '#B8792B', pill: '#FBF1DE', bg: '#FAF6F1', border: '#F0DFC4' },
  { key: 'processing', title: 'In progress', dot: '#3B5B9E', pill: '#EAF0FB', bg: '#FAF6F1', border: '#D6E0F0' },
  { key: 'paid', title: 'Paid', dot: '#1F7A52', pill: '#EAF3EE', bg: '#FAF6F1', border: '#CDE6D8' },
] as const;

export function SettlementsPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') ?? 'run';
  const detail = parseDetailParam(params.get('detail'));
  const queryClient = useQueryClient();
  const fireToast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [method, setMethod] = useState<string>('BANK_TRANSFER');
  const [reference, setReference] = useState('');

  const run = useQuery({
    queryKey: ['admin', 'settlement-run'],
    queryFn: () => platformAdminService.getSettlementRun(),
    staleTime: 15_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'settlement-run'] });

  const createRun = useMutation({
    mutationFn: () => platformAdminService.createSettlementRun(),
    onSuccess: () => { refresh(); fireToast("Tonight's run is ready"); },
    onError: () => fireToast('Could not build the run', 'no'),
  });

  const startItem = useMutation({
    mutationFn: (id: string) => platformAdminService.startSettlementItem(id),
    onSuccess: () => { refresh(); fireToast('Moved to in progress'); },
    onError: (e: any) => fireToast(e?.response?.data?.message ?? 'Could not start that payout', 'no'),
  });

  const payItem = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      platformAdminService.paySettlementItem(id, method, reference.trim()),
    onSuccess: () => {
      refresh();
      closeDrawer();
      fireToast('Payout recorded');
    },
    onError: (e: any) => fireToast(e?.response?.data?.message ?? 'Could not record that payout', 'no'),
  });

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value == null) next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };

  const closeDrawer = () => {
    setParam('detail', null);
    setConfirming(false);
    setReference('');
  };

  const data = run.data;
  const items: any[] = data?.items ?? [];
  const totals = data?.totals;
  const openItem = detail?.kind === 'settlement' ? items.find((i) => i.id === detail.id) : undefined;
  const progressPct = totals && totals.total_count > 0
    ? Math.round((totals.done_count / totals.total_count) * 100)
    : 0;

  return (
    <div className="flex animate-[adFade_.25s_ease] flex-col gap-5">
      <SegmentedTabs
        tabs={[
          { key: 'run', label: "Tonight's run" },
          { key: 'directory', label: 'Owners & hostels' },
          { key: 'history', label: 'History & logs' },
        ]}
        active={view}
        onChange={(k) => setParam('view', k === 'run' ? null : k)}
      />

      {view !== 'run' ? (
        <NotWiredYet
          title={view === 'directory' ? 'The settlement directory is next' : 'Run history is next'}
        />
      ) : run.isLoading ? (
        <div className="py-16 text-center text-[13px] text-[#8A7F75]">Loading tonight's run…</div>
      ) : (
        <>
          {/* ── pooled-account banner ─────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-6 rounded-[20px] bg-[#201C18] px-6 py-[22px]">
            <div className="min-w-[240px] flex-1">
              <span className="mb-2.5 inline-flex items-center gap-1.5 rounded-full bg-[#B46A55]/[.22] px-3 py-1.5">
                <span className="h-[7px] w-[7px] rounded-full bg-[#E0A97F]" />
                <span className="text-[10px] font-bold uppercase tracking-[.08em] text-[#E0A97F]">
                  Settlement run · {data?.date}
                </span>
              </span>
              <div className="font-admin text-[16px] font-extrabold tracking-[-0.01em] text-white">
                Stayo pooled account → owner payouts
              </div>
              {/* Kept close to the design's wording: this is the thing an admin
                  must not misunderstand. Stayo takes nothing here. */}
              <p className="mt-1 max-w-[540px] text-[12.5px] leading-relaxed text-[#B9AFA3]">
                Rent collected through Stayo is passed on <b className="text-[#E0D5C9]">in full</b> to
                each owner — no commission is deducted. Verify the bank and the amount before marking
                any payout paid.
              </p>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-semibold text-[#8A7F75]">To settle</div>
              <div className="mt-0.5 font-admin text-[34px] font-extrabold tracking-[-0.03em] text-white">
                {formatInr(totals?.to_settle ?? 0)}
              </div>
              <div className="mt-0.5 font-admin text-[11.5px] font-semibold text-[#E0A97F]">
                {totals?.pending_count ?? 0} owners pending
              </div>
            </div>
          </div>

          {!data?.run ? (
            <div className={`${ADMIN_CARD} px-5 py-12 text-center`}>
              <div className="font-admin text-[17px] font-bold text-[#221E1A]">No run for today yet</div>
              <p className="mx-auto mt-1.5 max-w-[440px] text-[13px] leading-relaxed text-[#8A7F75]">
                Building a run gathers every rent payment Stayo captured today and works out what each
                owner is owed.
              </p>
              <button
                type="button"
                disabled={createRun.isPending}
                onClick={() => createRun.mutate()}
                className="mt-4 rounded-xl bg-[#B46A55] px-5 py-3 font-admin text-[13px] font-bold text-white disabled:opacity-50"
              >
                {createRun.isPending ? 'Building…' : "Build tonight's run"}
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className={`${ADMIN_CARD} px-5 py-12 text-center`}>
              <div className="font-admin text-[17px] font-bold text-[#221E1A]">Nothing to settle today</div>
              <p className="mx-auto mt-1.5 max-w-[460px] text-[13px] leading-relaxed text-[#8A7F75]">
                No rent was collected into Stayo's account today, so no owner is owed a payout.
                Rent an owner collected directly in cash or UPI is already theirs and never appears here.
              </p>
              <div className="mx-auto mt-4 flex max-w-[460px] items-start gap-2 rounded-xl bg-[#FAF6F1] px-3.5 py-3 text-left">
                <Info className="mt-0.5 h-4 w-4 flex-none text-[#8A7F75]" strokeWidth={1.8} />
                <span className="text-[11.5px] leading-relaxed text-[#5A5147]">
                  Online rent collection isn't live yet, so nothing is being captured into the Stayo
                  account to pass on. This screen starts working the day it is.
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-[13px] lg:grid-cols-4">
                <StatCard label="To settle" value={formatInr(totals?.to_settle ?? 0)} sub="owed to owners" valueTone="amber" />
                <StatCard label="Settled" value={formatInr(totals?.settled ?? 0)} sub="paid tonight" valueTone="green" />
                <StatCard label="Owners" value={String(totals?.total_count ?? 0)} sub="in this run" />
                <StatCard label="Collected" value={formatInr(data.run.gross_collected)} sub="through Stayo today" />
              </div>

              <div className={`${ADMIN_CARD} flex flex-wrap items-center gap-4 px-[18px] py-[15px]`}>
                <div className="min-w-[220px] flex-1">
                  <div className="mb-1.5 flex justify-between">
                    <span className="font-admin text-[12px] font-bold text-[#221E1A]">Tonight's progress</span>
                    <span className="text-[11.5px] font-semibold text-[#8A7F75]">
                      {totals?.done_count} of {totals?.total_count} settled · {progressPct}%
                    </span>
                  </div>
                  <div className="h-[9px] overflow-hidden rounded-full bg-[#F0EAE2]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#1F7A52] to-[#3FA274] transition-[width] duration-300"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* ── lanes ───────────────────────────────────────────── */}
              <div className="grid items-start gap-3.5 lg:grid-cols-3">
                {LANES.map((lane) => {
                  const laneItems = (data.lanes as any)?.[lane.key] ?? [];
                  const laneSum = laneItems.reduce((t: number, i: any) => t + i.amount, 0);
                  return (
                    <div
                      key={lane.key}
                      className="flex min-h-[260px] flex-col gap-2.5 rounded-2xl border-[1.5px] p-3"
                      style={{ background: lane.bg, borderColor: lane.border }}
                    >
                      <div className="flex items-center gap-2 px-1 py-0.5">
                        <span className="h-[9px] w-[9px] rounded-[3px]" style={{ background: lane.dot }} />
                        <span className="font-admin text-[12.5px] font-bold text-[#221E1A]">{lane.title}</span>
                        <span
                          className="rounded-full px-2 py-0.5 font-admin text-[10.5px] font-bold"
                          style={{ background: lane.pill, color: lane.dot }}
                        >
                          {laneItems.length}
                        </span>
                        <span className="flex-1" />
                        <span className="text-[11px] font-semibold text-[#8A7F75]">{formatInr(laneSum)}</span>
                      </div>

                      {laneItems.length === 0 ? (
                        <div className="rounded-xl border-[1.5px] border-dashed border-[#DBCFC0] px-2.5 py-6 text-center text-[11.5px] font-medium text-[#B0A597]">
                          Nothing here
                        </div>
                      ) : (
                        laneItems.map((item: any) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setParam('detail', serializeDetail({ kind: 'settlement', id: item.id }))}
                            className="rounded-[13px] border border-[#EFE6DA] bg-white p-3.5 text-left shadow-[0_1px_2px_rgba(40,30,20,.05)] hover:border-[#DCC9BE]"
                          >
                            <div className="flex items-center gap-2.5">
                              <span
                                className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full font-admin text-[11.5px] font-bold text-white"
                                style={{ background: tintForId(item.owner_id) }}
                              >
                                {(item.owner_name ?? '?').slice(0, 2).toUpperCase()}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12.5px] font-semibold text-[#2A2521]">
                                  {item.owner_name}
                                </span>
                                <span className="block text-[10.5px] text-[#9A8F84]">
                                  {item.payment_count} payment{item.payment_count === 1 ? '' : 's'}
                                </span>
                              </span>
                            </div>
                            <div className="mt-2.5 font-admin text-[18px] font-extrabold tracking-[-0.02em] text-[#221E1A]">
                              {formatInr(item.amount)}
                            </div>
                            <div className="mt-2 flex items-center justify-between border-t border-[#F4EEE7] pt-2">
                              <span className="font-mono text-[11px] text-[#7A6F63]">
                                {item.payout ? `••••${String(item.payout.account).slice(-4)}` : 'No account'}
                              </span>
                              <span className="text-[10px] font-semibold text-[#B46A55]">Open ›</span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ── payout drawer ──────────────────────────────────────── */}
      {openItem && (
        <AdminDrawer
          title={openItem.owner_name}
          subtitle={`${openItem.payment_count} tenant payment${openItem.payment_count === 1 ? '' : 's'}`}
          initials={(openItem.owner_name ?? '?').slice(0, 2).toUpperCase()}
          tint={tintForId(openItem.owner_id)}
          radius="rounded-full"
          onClose={closeDrawer}
          footer={
            openItem.status === 'PENDING' ? (
              <button
                type="button"
                onClick={() => startItem.mutate(openItem.id)}
                className="w-full rounded-xl bg-[#B8792B] py-3.5 font-admin text-[13.5px] font-bold text-white shadow-[0_4px_14px_rgba(184,121,43,.28)]"
              >
                Start payout · move to in progress
              </button>
            ) : openItem.status === 'PROCESSING' || openItem.status === 'FAILED' ? (
              confirming ? (
                <div>
                  <div className="mb-3 rounded-xl border border-[#EFD6CE] bg-[#FBEFE9] px-3.5 py-3">
                    <div className="font-admin text-[12.5px] font-bold text-[#8A3E2A]">
                      Confirm this payout is irreversible
                    </div>
                    <p className="mt-1 text-[12px] leading-[1.55] text-[#6E5B4E]">
                      You are recording <b>{formatInr(openItem.amount)}</b> sent to{' '}
                      <b>{openItem.payout?.holder ?? openItem.owner_name}</b>
                      {openItem.payout ? <> at <b>{openItem.payout.bank ?? openItem.payout.ifsc}</b></> : null}{' '}
                      via <b>{METHOD_LABEL[method]}</b>. Only confirm once the transfer is done.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      className="flex-1 rounded-xl border border-[#E9DFD3] bg-white py-3 font-admin text-[13px] font-bold text-[#5A5147]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={payItem.isPending}
                      onClick={() => payItem.mutate({ id: openItem.id })}
                      className="flex-[1.4] rounded-xl bg-[#1F7A52] py-3 font-admin text-[13px] font-bold text-white disabled:opacity-50"
                    >
                      {payItem.isPending ? 'Recording…' : 'Yes, mark paid'}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[.05em] text-[#A2978B]">
                    How was it sent?
                  </div>
                  <div className="mb-2.5 flex flex-wrap gap-1.5">
                    {PAYOUT_METHODS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMethod(m)}
                        className={`rounded-[10px] border px-3 py-2 text-[12px] font-semibold ${
                          method === m
                            ? 'border-[#221E1A] bg-[#221E1A] text-white'
                            : 'border-[#EAE1D8] bg-white text-[#5A5147]'
                        }`}
                      >
                        {METHOD_LABEL[m]}
                      </button>
                    ))}
                  </div>
                  <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[.05em] text-[#A2978B]">
                    UTR / reference
                  </div>
                  <input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="From your bank, after the transfer"
                    className="mb-2.5 w-full rounded-[11px] border border-[#E7DDD1] px-3.5 py-3 font-mono text-[13px] text-[#2A2521] outline-none"
                  />
                  <button
                    type="button"
                    disabled={!reference.trim()}
                    onClick={() => setConfirming(true)}
                    className="w-full rounded-xl bg-[#1F7A52] py-3.5 font-admin text-[13.5px] font-bold text-white disabled:opacity-40"
                  >
                    Mark as paid · {formatInr(openItem.amount)}
                  </button>
                </div>
              )
            ) : null
          }
        >
          <div className="flex flex-col gap-4">
            <div className={`rounded-2xl border px-5 py-[18px] ${
              openItem.status === 'PAID'
                ? 'border-[#CDE6D8] bg-[#EAF3EE]'
                : 'border-[#EFE6DA] bg-white'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] font-semibold text-[#8A7F75]">Payable to owner · full rent</span>
                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#5A5147]">
                  {openItem.status}
                </span>
              </div>
              <div className="mt-2 font-admin text-[34px] font-extrabold tracking-[-0.03em] text-[#221E1A]">
                {formatInr(openItem.amount)}
              </div>
              <p className="mt-2 text-[11.5px] text-[#8A7F75]">
                {openItem.payment_count} tenant payment{openItem.payment_count === 1 ? '' : 's'} · passed
                through in full, no deduction
              </p>
            </div>

            {openItem.payout ? (
              <DrawerSection
                title="Payout destination"
                action={
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(
                        `${openItem.payout.holder}\n${openItem.payout.account}\n${openItem.payout.ifsc}`,
                      );
                      fireToast('Bank details copied');
                    }}
                    className="flex items-center gap-1 text-[10.5px] font-semibold text-[#B46A55]"
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </button>
                }
              >
                <KeyValueRows
                  rows={[
                    { k: 'Holder', v: openItem.payout.holder ?? '—' },
                    { k: 'Account', v: <span className="font-mono">{openItem.payout.account}</span> },
                    { k: 'IFSC', v: <span className="font-mono">{openItem.payout.ifsc ?? '—'}</span> },
                    { k: 'Bank', v: openItem.payout.bank ?? '—' },
                  ]}
                />
              </DrawerSection>
            ) : (
              /* Better to say this than to let an admin start a payout they
                 cannot finish. */
              <div className="flex items-start gap-2.5 rounded-2xl border border-[#F0DFC4] bg-[#FBF1DE] px-4 py-3.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-[#B8792B]" strokeWidth={2} />
                <div>
                  <div className="text-[12.5px] font-bold text-[#B8792B]">No payout account on file</div>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-[#6E5B4E]">
                    This owner hasn't added their bank details in Settings yet, so there is nowhere to
                    send this. Ask them to add it before settling.
                  </p>
                </div>
              </div>
            )}

            {openItem.status === 'PAID' && (
              <DrawerSection title="Payout completed">
                <KeyValueRows
                  rows={[
                    { k: 'Method', v: METHOD_LABEL[openItem.method] ?? openItem.method },
                    { k: 'Reference', v: <span className="font-mono">{openItem.reference}</span> },
                    {
                      k: 'Settled at',
                      v: openItem.paid_at ? new Date(openItem.paid_at).toLocaleString('en-IN') : '—',
                    },
                  ]}
                />
              </DrawerSection>
            )}

            {openItem.status === 'FAILED' && openItem.failure_reason && (
              <div className="rounded-2xl border border-[#EFD6CE] bg-[#FBEFE9] px-4 py-3.5">
                <div className="text-[11px] font-bold uppercase tracking-[.06em] text-[#B3402F]">
                  Transfer failed
                </div>
                <p className="mt-1 text-[12px] text-[#6E5B4E]">{openItem.failure_reason}</p>
              </div>
            )}
          </div>
        </AdminDrawer>
      )}
    </div>
  );
}
