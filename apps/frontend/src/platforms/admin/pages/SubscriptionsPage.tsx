import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformAdminService } from '@features/platform-admin/api';
import { Avatar, DataTable, EmptyState, Field, FilterChips, Modal, MODAL_INPUT, ModalFooter, SegmentedTabs, StatCard, type DataColumn } from '../ui';
import { tintForId } from '../theme/palette';
import { useToast } from '../layout/toastContext';
import {
  adminError,
  availableActions,
  canActivateFounding,
  capacityText,
  formatDate,
  formatPaise,
  initialsOf,
  isReviewablePayment,
  overrideActive,
  paymentMethodLabel,
  paymentStatusView,
  planLabel,
  PLAN_FILTER_CHIPS,
  subStatusView,
} from '../billing/subscriptionAdminView';
import { BillingSettingsPanel } from '../billing/BillingSettingsPanel';

const TONE_CLASS: Record<string, string> = {
  ok: 'bg-[#E6F0E8] text-[#3F7D58]',
  warn: 'bg-[#FBF0DC] text-[#8A6410]',
  bad: 'bg-[#FBE4E1] text-[#A5402F]',
  info: 'bg-[#E4EEF5] text-[#2E5D77]',
  muted: 'bg-[#EFEAE3] text-[#7A6F63]',
};

const Pill = ({ label, tone }: { label: string; tone: string }) => (
  <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase ${TONE_CLASS[tone] ?? TONE_CLASS.muted}`}>
    {label}
  </span>
);

const SUB_COLUMNS: DataColumn[] = [
  { key: 'owner', label: 'Owner', width: '1.6fr' },
  { key: 'status', label: 'Status', width: '1fr' },
  { key: 'plan', label: 'Plan', width: '1fr' },
  { key: 'usage', label: 'Usage', width: '0.8fr' },
  { key: 'amount', label: 'Amount', width: '0.8fr' },
  { key: 'renewal', label: 'Renewal', width: '1fr' },
  { key: 'latest', label: 'Latest payment', width: '1fr' },
  { key: 'actions', label: '', width: '1.4fr' },
];

const PAY_COLUMNS: DataColumn[] = [
  { key: 'owner', label: 'Owner', width: '1.4fr' },
  { key: 'plan', label: 'Plan', width: '1fr' },
  { key: 'amount', label: 'Amount', width: '0.8fr' },
  { key: 'method', label: 'Method', width: '0.9fr' },
  { key: 'ref', label: 'Reference', width: '1fr' },
  { key: 'proof', label: 'Proof', width: '0.6fr' },
  { key: 'submitted', label: 'Submitted', width: '1fr' },
  { key: 'status', label: 'Status', width: '0.9fr' },
  { key: 'actions', label: '', width: '1.2fr' },
];

export function SubscriptionsPage() {
  const [tab, setTab] = useState<'subscriptions' | 'payments' | 'settings'>('subscriptions');
  return (
    <div className="flex flex-col gap-5 p-5 lg:p-7">
      <SegmentedTabs
        tabs={[
          { key: 'subscriptions', label: 'Subscriptions' },
          { key: 'payments', label: 'Payment review' },
          { key: 'settings', label: 'Billing settings' },
        ]}
        active={tab}
        onChange={(k) => setTab(k as any)}
      />
      {tab === 'subscriptions' && <SubscriptionsTab />}
      {tab === 'payments' && <PaymentQueueTab />}
      {tab === 'settings' && <BillingSettingsPanel />}
    </div>
  );
}

type SubModal =
  | null
  | { type: 'pause'; row: any }
  | { type: 'resume'; row: any }
  | { type: 'extend'; row: any }
  | { type: 'plan'; row: any }
  | { type: 'cash'; row: any }
  | { type: 'activateFounding'; row: any };

// ── Subscriptions list + actions ──────────────────────────────────────────
function SubscriptionsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('ALL');
  // Founding / Starter / Growth / Professional / Portfolio (business rules, 2026-09-10).
  const [planCode, setPlanCode] = useState('ALL');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<SubModal>(null);

  const list = useQuery({
    queryKey: ['admin', 'subscriptions', status, planCode, search],
    queryFn: () =>
      platformAdminService.getSubscriptions({
        status,
        planCode: planCode === 'ALL' ? undefined : planCode,
        search: search || undefined,
      }),
    staleTime: 20_000,
  });
  const plansQuery = useQuery({
    queryKey: ['admin', 'subscription-plans'],
    queryFn: () => platformAdminService.getSubscriptionPlans(),
    staleTime: 5 * 60_000,
  });
  const plans = plansQuery.data?.plans ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'subscriptions'] });
    qc.invalidateQueries({ queryKey: ['admin', 'subscription-payments'] });
  };

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    try {
      await fn();
      refresh();
      setModal(null);
      toast(okMsg, 'ok');
    } catch (e) {
      toast(adminError(e), 'no');
    }
  };

  const rows = (list.data?.subscriptions ?? []).map((s: any) => ({ ...s, id: s.id }));
  const counts = list.data?.status_counts ?? {};
  const chips = [
    { key: 'ALL', label: 'All' },
    { key: 'ACTIVE', label: 'Active', count: counts.ACTIVE },
    { key: 'PENDING_PAYMENT', label: 'Pending', count: counts.PENDING_PAYMENT },
    { key: 'PAUSED', label: 'Paused', count: counts.PAUSED },
    { key: 'EXPIRED', label: 'Expired', count: counts.EXPIRED },
    { key: 'CANCELLED', label: 'Cancelled', count: counts.CANCELLED },
  ];
  const planCounts = list.data?.plan_counts ?? {};
  const planChips = PLAN_FILTER_CHIPS.map((c) => ({
    ...c,
    count: c.key === 'ALL' ? undefined : planCounts[c.key],
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <FilterChips chips={chips} active={status} onChange={setStatus} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <FilterChips chips={planChips} active={planCode} onChange={setPlanCode} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search owner name / email / phone"
          className="w-full rounded-[10px] border border-[#EAE1D8] bg-white px-3 py-2 text-[12.5px] outline-none focus:border-[#221E1A] sm:ml-auto sm:w-auto sm:max-w-[280px]"
        />
      </div>

      {list.isLoading ? (
        <p className="text-[13px] text-[#8A7F75]">Loading subscriptions…</p>
      ) : list.isError ? (
        <EmptyState title="Could not load subscriptions" message={adminError(list.error)} />
      ) : (
        <DataTable
          columns={SUB_COLUMNS}
          rows={rows}
          empty="No subscriptions match this filter."
          renderCell={(row: any, key) => {
            const sv = subStatusView(row.status);
            switch (key) {
              case 'owner':
                return (
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar photoUrl={row.owner?.photo_url} initials={initialsOf(row.owner?.name)} tint={tintForId(String(row.owner?.id ?? row.id))} size={32} />
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-semibold text-[#221E1A]">{row.owner?.name ?? '—'}</div>
                      <div className="truncate text-[11px] text-[#8A7F75]">{row.owner?.email ?? row.owner?.phone ?? ''}</div>
                    </div>
                  </div>
                );
              case 'status':
                return (
                  <div className="flex flex-col gap-1">
                    <Pill label={sv.label} tone={sv.tone} />
                    {overrideActive(row.admin_override_until) && (
                      <span className="text-[10px] font-semibold text-[#2E5D77]">Override → {formatDate(row.admin_override_until)}</span>
                    )}
                  </div>
                );
              case 'plan':
                return (
                  <div className="min-w-0">
                    <div className="truncate text-[12px] text-[#221E1A]">
                      {row.plan?.name ?? '—'}
                      {row.extra_beds > 0 ? ` +${row.extra_beds}` : ''}
                    </div>
                    {row.founding_partner_number != null && (
                      <div className="truncate text-[10.5px] font-bold text-[#8A6410]">Founding Partner #{row.founding_partner_number}</div>
                    )}
                    {row.pending_plan && (
                      <div className="truncate text-[10.5px] text-[#8A6410]">→ {row.pending_plan.name} next period</div>
                    )}
                  </div>
                );
              case 'usage':
                return <span className="text-[12px] text-[#5A5147]">{capacityText(row.usage)}</span>;
              case 'amount':
                return (
                  <div className="min-w-0">
                    <span className="text-[12px] font-semibold text-[#221E1A]">
                      {formatPaise(row.recurring_amount_paise ?? row.amount_paise)}
                    </span>
                    {row.extra_beds > 0 && (
                      <div className="truncate text-[10.5px] text-[#8A7F75]">
                        {formatPaise(row.amount_paise)} plan + {formatPaise((row.recurring_amount_paise ?? row.amount_paise) - row.amount_paise)} extra beds
                      </div>
                    )}
                  </div>
                );
              case 'renewal':
                return <span className="text-[12px] text-[#5A5147]">{formatDate(row.next_renewal_at)}</span>;
              case 'latest':
                return row.latest_payment ? (
                  <div className="flex flex-col gap-0.5">
                    <Pill label={paymentStatusView(row.latest_payment.status).label} tone={paymentStatusView(row.latest_payment.status).tone} />
                    <span className="text-[10.5px] text-[#8A7F75]">{formatPaise(row.latest_payment.amount_paise)}</span>
                  </div>
                ) : (
                  <span className="text-[11px] text-[#B4A99C]">none</span>
                );
              case 'actions':
                return <SubscriptionActions row={row} onOpen={setModal} />;
              default:
                return null;
            }
          }}
          renderMobileCard={(row: any) => {
            const sv = subStatusView(row.status);
            return (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar photoUrl={row.owner?.photo_url} initials={initialsOf(row.owner?.name)} tint={tintForId(String(row.owner?.id ?? row.id))} size={36} />
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-semibold text-[#221E1A]">{row.owner?.name ?? '—'}</div>
                      <div className="truncate text-[11px] text-[#8A7F75]">{row.owner?.email ?? row.owner?.phone ?? ''}</div>
                    </div>
                  </div>
                  <Pill label={sv.label} tone={sv.tone} />
                </div>

                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-[#5A5147]">
                  <span className="font-semibold text-[#221E1A]">
                    {row.plan?.name ?? '—'}
                    {row.extra_beds > 0 ? ` +${row.extra_beds}` : ''}
                  </span>
                  <span className="text-[#D8CFC3]">·</span>
                  <span>{capacityText(row.usage)}</span>
                  {row.founding_partner_number != null && (
                    <span className="font-bold text-[#8A6410]">· Founding #{row.founding_partner_number}</span>
                  )}
                  {row.pending_plan && <span className="text-[#8A6410]">· → {row.pending_plan.name} next period</span>}
                  {overrideActive(row.admin_override_until) && (
                    <span className="font-semibold text-[#2E5D77]">· Override → {formatDate(row.admin_override_until)}</span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 rounded-[10px] bg-[#FAF6F1] px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[9px] font-bold uppercase tracking-[.05em] text-[#A2978B]">Amount</div>
                    <div className="text-[13.5px] font-bold text-[#221E1A]">{formatPaise(row.recurring_amount_paise ?? row.amount_paise)}</div>
                  </div>
                  <div className="min-w-0 text-right">
                    <div className="text-[9px] font-bold uppercase tracking-[.05em] text-[#A2978B]">Renewal</div>
                    <div className="text-[12px] text-[#5A5147]">{formatDate(row.next_renewal_at)}</div>
                  </div>
                  <div className="min-w-0 text-right">
                    <div className="text-[9px] font-bold uppercase tracking-[.05em] text-[#A2978B]">Latest payment</div>
                    {row.latest_payment ? (
                      <Pill label={paymentStatusView(row.latest_payment.status).label} tone={paymentStatusView(row.latest_payment.status).tone} />
                    ) : (
                      <span className="text-[11px] text-[#B4A99C]">none</span>
                    )}
                  </div>
                </div>

                <SubscriptionActions row={row} onOpen={setModal} compact />
              </div>
            );
          }}
        />
      )}

      {modal?.type === 'pause' && <PauseModal row={modal.row} onClose={() => setModal(null)} run={run} />}
      {modal?.type === 'resume' && <ResumeModal row={modal.row} onClose={() => setModal(null)} run={run} />}
      {modal?.type === 'extend' && <ExtendModal row={modal.row} onClose={() => setModal(null)} run={run} />}
      {modal?.type === 'plan' && <ChangePlanModal row={modal.row} plans={plans} onClose={() => setModal(null)} run={run} />}
      {modal?.type === 'cash' && <CashModal row={modal.row} plans={plans} onClose={() => setModal(null)} run={run} />}
      {modal?.type === 'activateFounding' && <ActivateFoundingModal row={modal.row} onClose={() => setModal(null)} run={run} />}
    </div>
  );
}

function SubscriptionActions({ row, onOpen, compact }: { row: any; onOpen: (m: SubModal) => void; compact?: boolean }) {
  const acts = availableActions(row.status);
  const showFounding = canActivateFounding(row.status, row.plan?.code);
  if (!showFounding && acts.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${compact ? 'gap-1.5 border-t border-[#F2ECE5] pt-2.5' : ''}`}>
      {showFounding && (
        <ActBtn onClick={() => onOpen({ type: 'activateFounding', row })} primary>
          Mark as Paid & Activate
        </ActBtn>
      )}
      {acts.includes('pause') && <ActBtn onClick={() => onOpen({ type: 'pause', row })}>Pause</ActBtn>}
      {acts.includes('resume') && <ActBtn onClick={() => onOpen({ type: 'resume', row })}>Resume</ActBtn>}
      {acts.includes('extend') && <ActBtn onClick={() => onOpen({ type: 'extend', row })}>Extend</ActBtn>}
      {acts.includes('change-plan') && <ActBtn onClick={() => onOpen({ type: 'plan', row })}>Plan</ActBtn>}
      {acts.includes('cash') && <ActBtn onClick={() => onOpen({ type: 'cash', row })}>Cash</ActBtn>}
    </div>
  );
}

// ── Subscription action modals ────────────────────────────────────────────
function PauseModal({ row, onClose, run }: { row: any; onClose: () => void; run: (fn: () => Promise<unknown>, okMsg: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title="Pause this subscription" subtitle={row.owner?.name} onClose={onClose}>
      <div className="flex flex-col gap-3.5 px-5 py-5 sm:px-6">
        <div className="rounded-xl bg-[#FBEFE9] px-3.5 py-3 text-[11.5px] leading-relaxed text-[#A5402F]">
          The owner will lose platform access immediately.
        </div>
        <Field label="Reason for pausing">
          <textarea className={`${MODAL_INPUT} min-h-[80px] resize-y`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this subscription being paused?" autoFocus />
        </Field>
      </div>
      <ModalFooter
        onCancel={onClose}
        onConfirm={() => run(() => platformAdminService.pauseSubscription(row.id, reason.trim()), 'Subscription paused')}
        confirmLabel="Pause subscription"
        confirmTone="red"
        disabled={!reason.trim()}
      />
    </Modal>
  );
}

function ResumeModal({ row, onClose, run }: { row: any; onClose: () => void; run: (fn: () => Promise<unknown>, okMsg: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title="Resume this subscription" subtitle={row.owner?.name} onClose={onClose}>
      <div className="flex flex-col gap-3.5 px-5 py-5 sm:px-6">
        <Field label="Reason for resuming">
          <textarea className={`${MODAL_INPUT} min-h-[80px] resize-y`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this subscription being resumed?" autoFocus />
        </Field>
      </div>
      <ModalFooter
        onCancel={onClose}
        onConfirm={() =>
          run(
            () => platformAdminService.resumeSubscription(row.id, reason.trim()),
            'Resumed — owner is now PENDING_PAYMENT (they must pay, or use Extend to grant access)',
          )
        }
        confirmLabel="Resume subscription"
        confirmTone="green"
        disabled={!reason.trim()}
      />
    </Modal>
  );
}

function ExtendModal({ row, onClose, run }: { row: any; onClose: () => void; run: (fn: () => Promise<unknown>, okMsg: string) => void }) {
  const [days, setDays] = useState('7');
  const [reason, setReason] = useState('');
  const n = Number(days);
  const validDays = Number.isInteger(n) && n >= 1 && n <= 30;
  return (
    <Modal title="Extend access" subtitle={row.owner?.name} onClose={onClose}>
      <div className="flex flex-col gap-3.5 px-5 py-5 sm:px-6">
        <Field label="Extend by how many days?" hint="1–30 days">
          <input type="number" min={1} max={30} className={MODAL_INPUT} value={days} onChange={(e) => setDays(e.target.value)} autoFocus />
        </Field>
        <Field label="Reason for the extension">
          <textarea className={`${MODAL_INPUT} min-h-[70px] resize-y`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is access being extended?" />
        </Field>
      </div>
      <ModalFooter
        onCancel={onClose}
        onConfirm={() => run(() => platformAdminService.extendSubscription(row.id, { days: n, reason: reason.trim() }), `Access extended ${n} day(s)`)}
        confirmLabel={`Extend ${validDays ? `${n} day(s)` : ''}`}
        disabled={!validDays || !reason.trim()}
      />
    </Modal>
  );
}

/** Extra-beds field, shared by Change Plan (IMMEDIATE only) and Cash — the
 * backend validates the count against the plan's allowance regardless of
 * what's entered here (business rules, 2026-09-10). */
function ExtraBedsField({ plan, value, onChange }: { plan: any; value: string; onChange: (v: string) => void }) {
  if (!plan) return null;
  const allowance =
    plan.max_extra_beds == null ? 'no limit' : plan.max_extra_beds === 0 ? 'not offered on this plan' : `up to ${plan.max_extra_beds}`;
  if (plan.max_extra_beds === 0) return null;
  return (
    <Field label="Extra beds" hint={`Beyond the ${plan.included_beds ?? '—'} included (${allowance}, ₹${(plan.extra_bed_price_paise ?? 0) / 100}/bed). Leave blank for 0.`}>
      <input type="number" min={0} className={MODAL_INPUT} value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" />
    </Field>
  );
}

function ChangePlanModal({ row, plans, onClose, run }: { row: any; plans: any[]; onClose: () => void; run: (fn: () => Promise<unknown>, okMsg: string) => void }) {
  const [planId, setPlanId] = useState(row.plan?.id ?? '');
  const [effective, setEffective] = useState<'IMMEDIATE' | 'NEXT_PERIOD'>('IMMEDIATE');
  const [extraBeds, setExtraBeds] = useState('');
  const [reason, setReason] = useState('');
  const plan = plans.find((p: any) => p.id === planId);

  return (
    <Modal title="Change plan" subtitle={row.owner?.name} onClose={onClose}>
      <div className="flex flex-col gap-3.5 px-5 py-5 sm:px-6">
        <Field label="New plan">
          <select className={MODAL_INPUT} value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="" disabled>Choose a plan…</option>
            {plans.map((p: any) => <option key={p.id} value={p.id}>{planLabel(p)}</option>)}
          </select>
        </Field>
        <Field label="When should this take effect?">
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setEffective('IMMEDIATE')} className={`flex-1 rounded-[10px] border px-3 py-2 text-[12px] font-semibold ${effective === 'IMMEDIATE' ? 'border-[#221E1A] bg-[#221E1A] text-white' : 'border-[#E7DDD1] bg-white text-[#5A5147]'}`}>
              Immediately
            </button>
            <button type="button" onClick={() => setEffective('NEXT_PERIOD')} className={`flex-1 rounded-[10px] border px-3 py-2 text-[12px] font-semibold ${effective === 'NEXT_PERIOD' ? 'border-[#221E1A] bg-[#221E1A] text-white' : 'border-[#E7DDD1] bg-white text-[#5A5147]'}`}>
              Next period
            </button>
          </div>
        </Field>
        {effective === 'IMMEDIATE' && <ExtraBedsField plan={plan} value={extraBeds} onChange={setExtraBeds} />}
        <Field label="Reason for the plan change">
          <textarea className={`${MODAL_INPUT} min-h-[70px] resize-y`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is the plan changing?" />
        </Field>
      </div>
      <ModalFooter
        onCancel={onClose}
        onConfirm={() => {
          const beds = extraBeds.trim() ? Math.max(0, Math.floor(Number(extraBeds))) : undefined;
          run(
            () => platformAdminService.changeSubscriptionPlan(row.id, { plan_id: plan.id, effective, reason: reason.trim(), extra_beds: effective === 'IMMEDIATE' ? beds : undefined }),
            `Plan change (${effective}) recorded`,
          );
        }}
        confirmLabel="Change plan"
        disabled={!plan || !reason.trim()}
      />
    </Modal>
  );
}

function CashModal({ row, plans, onClose, run }: { row: any; plans: any[]; onClose: () => void; run: (fn: () => Promise<unknown>, okMsg: string) => void }) {
  const [planId, setPlanId] = useState(row.plan?.id ?? '');
  const [extraBeds, setExtraBeds] = useState('');
  const [rupees, setRupees] = useState('');
  const [reference, setReference] = useState('');
  const [approveNow, setApproveNow] = useState(true);
  const plan = plans.find((p: any) => p.id === planId);
  const beds = extraBeds.trim() ? Math.max(0, Math.floor(Number(extraBeds))) : 0;
  const defaultRupees = plan ? (plan.price_paise + beds * (plan.extra_bed_price_paise ?? 0)) / 100 : 0;
  const amount = rupees.trim() ? Number(rupees) : defaultRupees;
  const validAmount = Number.isFinite(amount) && amount > 0;

  return (
    <Modal title="Record a cash payment" subtitle={row.owner?.name} onClose={onClose}>
      <div className="flex flex-col gap-3.5 px-5 py-5 sm:px-6">
        <Field label="Plan">
          <select className={MODAL_INPUT} value={planId} onChange={(e) => { setPlanId(e.target.value); setRupees(''); }}>
            <option value="" disabled>Choose a plan…</option>
            {plans.map((p: any) => <option key={p.id} value={p.id}>{planLabel(p)}</option>)}
          </select>
        </Field>
        <ExtraBedsField plan={plan} value={extraBeds} onChange={(v) => { setExtraBeds(v); setRupees(''); }} />
        <Field label="Amount (₹)" hint={plan ? `Plan default: ₹${defaultRupees.toLocaleString('en-IN')}` : undefined}>
          <input type="number" min={1} className={MODAL_INPUT} value={rupees} onChange={(e) => setRupees(e.target.value)} placeholder={plan ? String(defaultRupees) : '0'} />
        </Field>
        <Field label="Reference / note" hint="Optional">
          <input className={MODAL_INPUT} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. cash handed to field agent" />
        </Field>
        <label className="flex items-center gap-2 text-[12.5px] font-semibold text-[#5A5147]">
          <input type="checkbox" checked={approveNow} onChange={(e) => setApproveNow(e.target.checked)} className="h-4 w-4 accent-[#B46A55]" />
          Approve this payment immediately after recording it
        </label>
      </div>
      <ModalFooter
        onCancel={onClose}
        onConfirm={() =>
          run(async () => {
            const created = await platformAdminService.recordCashSubscriptionPayment({
              owner_id: row.owner.id,
              plan_id: plan.id,
              amount_paise: Math.round(amount * 100),
              reference: reference.trim() || undefined,
              extra_beds: beds || undefined,
            });
            if (approveNow) await platformAdminService.approveSubscriptionPayment(created.id);
          }, approveNow ? 'Cash payment recorded and approved' : 'Cash payment recorded — awaiting your approval')
        }
        confirmLabel="Record payment"
        disabled={!plan || !validAmount}
      />
    </Modal>
  );
}

function ActivateFoundingModal({ row, onClose, run }: { row: any; onClose: () => void; run: (fn: () => Promise<unknown>, okMsg: string) => void }) {
  const [reference, setReference] = useState('');
  // Server-computed from LIVE active-bed usage (business rules, 2026-09-12) —
  // never the flat plan price alone, in case the owner already has active
  // tenants past the 250 included beds at the moment of first activation.
  const amount = formatPaise(row.founding_calculated_amount_paise ?? row.plan?.price_paise ?? row.amount_paise);
  return (
    <Modal title="Mark as paid & activate" subtitle={row.owner?.name} onClose={onClose}>
      <div className="flex flex-col gap-3.5 px-5 py-5 sm:px-6">
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-[#FAF6F1] px-3.5 py-3 text-[12px]">
          <div>
            <div className="text-[9.5px] font-bold uppercase tracking-[.05em] text-[#A2978B]">Founding Partner</div>
            <div className="font-semibold text-[#221E1A]">#{row.founding_partner_number ?? '—'}</div>
          </div>
          <div>
            <div className="text-[9.5px] font-bold uppercase tracking-[.05em] text-[#A2978B]">Active beds</div>
            <div className="font-semibold text-[#221E1A]">{row.usage?.used ?? 0} ({row.plan?.included_beds ?? 250} included, ₹{(row.plan?.extra_bed_price_paise ?? 1000) / 100}/extra)</div>
          </div>
          <div className="col-span-2">
            <div className="text-[9.5px] font-bold uppercase tracking-[.05em] text-[#A2978B]">Amount to activate</div>
            <div className="text-[15px] font-bold text-[#221E1A]">{amount}</div>
          </div>
        </div>
        <div className="rounded-xl bg-[#FBF1DE] px-3.5 py-3 text-[11.5px] leading-relaxed text-[#8A6410]">
          Only confirm once the client has actually paid {amount} outside Stayo. This activates a one-month subscription immediately.
        </div>
        <Field label="Payment reference / note" hint="Optional">
          <input className={MODAL_INPUT} value={reference} onChange={(e) => setReference(e.target.value)} autoFocus />
        </Field>
      </div>
      <ModalFooter
        onCancel={onClose}
        onConfirm={() => run(() => platformAdminService.activateFoundingSubscription(row.id, reference.trim() || undefined), 'Founding Partner subscription activated')}
        confirmLabel="Mark as paid & activate"
        confirmTone="dark"
      />
    </Modal>
  );
}

// ── Payment review queue ──────────────────────────────────────────────────
type PayModal = null | { type: 'approve'; row: any } | { type: 'reject'; row: any };

function PaymentQueueTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState('REVIEWABLE');
  const [modal, setModal] = useState<PayModal>(null);

  const queue = useQuery({
    queryKey: ['admin', 'subscription-payments', filter],
    queryFn: () =>
      platformAdminService.getSubscriptionPayments(filter === 'REVIEWABLE' ? undefined : filter),
    staleTime: 15_000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'subscription-payments'] });
    qc.invalidateQueries({ queryKey: ['admin', 'subscriptions'] });
  };

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    try {
      await fn();
      refresh();
      setModal(null);
      toast(okMsg, 'ok');
    } catch (e) {
      toast(adminError(e), 'no');
    }
  };

  const onApprove = (row: any) => setModal({ type: 'approve', row });
  const onReject = (row: any) => setModal({ type: 'reject', row });

  const approveNow = useMutation({
    mutationFn: (id: string) => platformAdminService.approveSubscriptionPayment(id),
    onSuccess: (res) => {
      refresh();
      setModal(null);
      toast(`Approved — subscription is now ${res.subscription?.status ?? 'updated'}${res.invoice?.invoice_number ? `, invoice ${res.invoice.invoice_number}` : ''}`, 'ok');
    },
    onError: (e) => toast(adminError(e), 'no'),
  });

  const downloadInvoice = useMutation({
    mutationFn: (invoiceId: string) => platformAdminService.downloadSubscriptionInvoice(invoiceId),
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    onError: (e) => toast(adminError(e), 'no'),
  });

  const rows = (queue.data?.payments ?? []).map((p: any) => ({ ...p, id: p.id }));

  return (
    <div className="flex flex-col gap-4">
      <FilterChips
        chips={[
          { key: 'REVIEWABLE', label: 'Awaiting review' },
          { key: 'APPROVED', label: 'Approved' },
          { key: 'REJECTED', label: 'Rejected' },
        ]}
        active={filter}
        onChange={setFilter}
      />
      {queue.isLoading ? (
        <p className="text-[13px] text-[#8A7F75]">Loading…</p>
      ) : queue.isError ? (
        <EmptyState title="Could not load the queue" message={adminError(queue.error)} />
      ) : (
        <DataTable
          columns={PAY_COLUMNS}
          rows={rows}
          empty="Nothing to review."
          renderCell={(row: any, key) => {
            const sv = paymentStatusView(row.status);
            switch (key) {
              case 'owner':
                return (
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar photoUrl={row.owner?.photo_url} initials={initialsOf(row.owner?.name)} tint={tintForId(String(row.owner?.id ?? row.id))} size={32} />
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-semibold text-[#221E1A]">{row.owner?.name ?? '—'}</div>
                      <div className="truncate text-[11px] text-[#8A7F75]">{row.owner?.email ?? ''}</div>
                    </div>
                  </div>
                );
              case 'plan':
                return (
                  <span className="text-[12px] text-[#221E1A]">
                    {row.plan?.name ?? row.plan?.code ?? '—'}
                    {row.extra_beds > 0 ? ` +${row.extra_beds}` : ''}
                  </span>
                );
              case 'amount':
                return (
                  <div className="min-w-0">
                    <span className="text-[12px] font-semibold text-[#221E1A]">{formatPaise(row.amount_paise)}</span>
                    {row.amount_mismatch && (
                      <div
                        className="truncate text-[10.5px] font-semibold text-[#A5402F]"
                        title="The declared amount doesn't match what the server calculates for this plan/extra-bed change. The invoice will still use the server-calculated amount regardless of what's approved here — review the proof before approving."
                      >
                        ⚠ expected {formatPaise(row.expected_amount_paise)}
                      </div>
                    )}
                  </div>
                );
              case 'method':
                return <span className="text-[12px] text-[#5A5147]">{paymentMethodLabel(row.payment_method)}</span>;
              case 'ref':
                return <span className="truncate text-[11.5px] text-[#5A5147]">{row.transaction_reference ?? '—'}</span>;
              case 'proof':
                return row.proof_file ? (
                  <a href={row.proof_file} target="_blank" rel="noreferrer" className="text-[11.5px] font-semibold text-[#2E5D77] underline">
                    View
                  </a>
                ) : (
                  <span className="text-[11px] text-[#B4A99C]">—</span>
                );
              case 'submitted':
                return <span className="text-[12px] text-[#5A5147]">{formatDate(row.submitted_at)}</span>;
              case 'status':
                return (
                  <div className="flex flex-col gap-0.5">
                    <Pill label={sv.label} tone={sv.tone} />
                    {row.status === 'REJECTED' && row.rejection_reason && (
                      <span className="text-[10px] text-[#A5402F]">{row.rejection_reason}</span>
                    )}
                  </div>
                );
              case 'actions':
                return (
                  <PaymentActions
                    row={row}
                    onApprove={onApprove}
                    onReject={onReject}
                    onDownloadInvoice={(id) => downloadInvoice.mutate(id)}
                    downloadPending={downloadInvoice.isPending}
                  />
                );
              default:
                return null;
            }
          }}
          renderMobileCard={(row: any) => {
            const sv = paymentStatusView(row.status);
            return (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar photoUrl={row.owner?.photo_url} initials={initialsOf(row.owner?.name)} tint={tintForId(String(row.owner?.id ?? row.id))} size={36} />
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-semibold text-[#221E1A]">{row.owner?.name ?? '—'}</div>
                      <div className="truncate text-[11px] text-[#8A7F75]">{row.owner?.email ?? ''}</div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <Pill label={sv.label} tone={sv.tone} />
                    {row.status === 'REJECTED' && row.rejection_reason && (
                      <span className="max-w-[140px] truncate text-[10px] text-[#A5402F]" title={row.rejection_reason}>{row.rejection_reason}</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-[#5A5147]">
                  <span className="font-semibold text-[#221E1A]">
                    {row.plan?.name ?? row.plan?.code ?? '—'}
                    {row.extra_beds > 0 ? ` +${row.extra_beds}` : ''}
                  </span>
                  <span className="text-[#D8CFC3]">·</span>
                  <span>{paymentMethodLabel(row.payment_method)}</span>
                  {row.transaction_reference && (
                    <>
                      <span className="text-[#D8CFC3]">·</span>
                      <span className="truncate">{row.transaction_reference}</span>
                    </>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 rounded-[10px] bg-[#FAF6F1] px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[9px] font-bold uppercase tracking-[.05em] text-[#A2978B]">Amount</div>
                    <div className="text-[13.5px] font-bold text-[#221E1A]">{formatPaise(row.amount_paise)}</div>
                    {row.amount_mismatch && (
                      <div className="text-[10px] font-semibold text-[#A5402F]">⚠ expected {formatPaise(row.expected_amount_paise)}</div>
                    )}
                  </div>
                  <div className="min-w-0 text-right">
                    <div className="text-[9px] font-bold uppercase tracking-[.05em] text-[#A2978B]">Submitted</div>
                    <div className="text-[12px] text-[#5A5147]">{formatDate(row.submitted_at)}</div>
                  </div>
                  <div className="min-w-0 text-right">
                    <div className="text-[9px] font-bold uppercase tracking-[.05em] text-[#A2978B]">Proof</div>
                    {row.proof_file ? (
                      <a href={row.proof_file} target="_blank" rel="noreferrer" className="text-[11.5px] font-semibold text-[#2E5D77] underline">
                        View
                      </a>
                    ) : (
                      <span className="text-[11px] text-[#B4A99C]">—</span>
                    )}
                  </div>
                </div>

                <PaymentActions
                  row={row}
                  onApprove={onApprove}
                  onReject={onReject}
                  onDownloadInvoice={(id) => downloadInvoice.mutate(id)}
                  downloadPending={downloadInvoice.isPending}
                  compact
                />
              </div>
            );
          }}
        />
      )}
      <p className="text-[11px] text-[#8A7F75]">
        Approval/rejection is the existing Phase 2 backend transaction — the UI never duplicates that logic. A payment can be
        reviewed once; a second attempt returns a clear error.
      </p>
      <StatsRow />

      {modal?.type === 'approve' && (
        <ApprovePaymentModal row={modal.row} onClose={() => setModal(null)} onConfirm={() => approveNow.mutate(modal.row.id)} pending={approveNow.isPending} />
      )}
      {modal?.type === 'reject' && <RejectPaymentModal row={modal.row} onClose={() => setModal(null)} run={run} />}
    </div>
  );
}

function PaymentActions({
  row, onApprove, onReject, onDownloadInvoice, downloadPending, compact,
}: {
  row: any;
  onApprove: (row: any) => void;
  onReject: (row: any) => void;
  onDownloadInvoice: (invoiceId: string) => void;
  downloadPending: boolean;
  compact?: boolean;
}) {
  if (isReviewablePayment(row.status)) {
    return (
      <div className={`flex gap-1.5 ${compact ? 'border-t border-[#F2ECE5] pt-2.5' : ''}`}>
        <ActBtn onClick={() => onApprove(row)} primary>
          Approve
        </ActBtn>
        <ActBtn onClick={() => onReject(row)}>Reject</ActBtn>
      </div>
    );
  }
  if (!row.invoice) return null;
  return (
    <div className={compact ? 'border-t border-[#F2ECE5] pt-2.5' : ''}>
      <ActBtn onClick={() => onDownloadInvoice(row.invoice.id)}>{downloadPending ? 'Preparing…' : 'Invoice'}</ActBtn>
    </div>
  );
}

function ApprovePaymentModal({
  row, onClose, onConfirm, pending,
}: { row: any; onClose: () => void; onConfirm: () => void; pending: boolean }) {
  return (
    <Modal title="Approve this payment" subtitle={row.owner?.name} onClose={onClose}>
      <div className="flex flex-col gap-3.5 px-5 py-5 sm:px-6">
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-[#FAF6F1] px-3.5 py-3 text-[12px]">
          <div>
            <div className="text-[9.5px] font-bold uppercase tracking-[.05em] text-[#A2978B]">Plan</div>
            <div className="font-semibold text-[#221E1A]">
              {row.plan?.name ?? row.plan?.code ?? '—'}
              {row.extra_beds > 0 ? ` +${row.extra_beds}` : ''}
            </div>
          </div>
          <div>
            <div className="text-[9.5px] font-bold uppercase tracking-[.05em] text-[#A2978B]">Amount</div>
            <div className="font-semibold text-[#221E1A]">{formatPaise(row.amount_paise)}</div>
          </div>
          <div>
            <div className="text-[9.5px] font-bold uppercase tracking-[.05em] text-[#A2978B]">Method</div>
            <div className="text-[#221E1A]">{paymentMethodLabel(row.payment_method)}</div>
          </div>
          <div>
            <div className="text-[9.5px] font-bold uppercase tracking-[.05em] text-[#A2978B]">Reference</div>
            <div className="text-[#221E1A]">{row.transaction_reference ?? '—'}</div>
          </div>
        </div>
        {row.amount_mismatch && (
          <div className="rounded-xl bg-[#FBEFE9] px-3.5 py-3 text-[11.5px] leading-relaxed text-[#A5402F]">
            ⚠ The declared amount doesn't match what the server calculates (expected {formatPaise(row.expected_amount_paise)}) — the invoice will
            still use the server-calculated amount regardless of what's approved here. Review the proof before approving.
          </div>
        )}
        <div className="text-[11.5px] leading-relaxed text-[#8A7F75]">
          This runs the atomic backend transaction: payment → APPROVED, subscription activated/updated, invoice issued.
        </div>
      </div>
      <ModalFooter onCancel={onClose} onConfirm={onConfirm} confirmLabel="Approve payment" confirmTone="green" pending={pending} />
    </Modal>
  );
}

function RejectPaymentModal({ row, onClose, run }: { row: any; onClose: () => void; run: (fn: () => Promise<unknown>, okMsg: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title="Reject this payment" subtitle={row.owner?.name} onClose={onClose}>
      <div className="flex flex-col gap-3.5 px-5 py-5 sm:px-6">
        <Field label="Reason for rejecting" hint="Shown to the owner">
          <textarea className={`${MODAL_INPUT} min-h-[80px] resize-y`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What's wrong with this payment?" autoFocus />
        </Field>
      </div>
      <ModalFooter
        onCancel={onClose}
        onConfirm={() => run(() => platformAdminService.rejectSubscriptionPayment(row.id, reason.trim()), 'Payment rejected — the owner is told the reason and can resubmit')}
        confirmLabel="Reject payment"
        confirmTone="red"
        disabled={!reason.trim()}
      />
    </Modal>
  );
}

function StatsRow() {
  const rev = useQuery({
    queryKey: ['admin', 'subscription-revenue'],
    queryFn: () => platformAdminService.getSubscriptionRevenue(),
    staleTime: 60_000,
  });
  const d = rev.data;
  if (!d) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard label="Awaiting review" value={String(d.payments?.pending_review ?? 0)} />
      <StatCard label="Approved (all time)" value={String(d.payments?.approved ?? 0)} />
      <StatCard label="Rejected (all time)" value={String(d.payments?.rejected ?? 0)} />
      <StatCard label="Active subscriptions" value={String(d.subscriptions?.active ?? 0)} />
    </div>
  );
}

function ActBtn({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[8px] px-2.5 py-1 text-[11px] font-bold ${
        primary ? 'bg-[#221E1A] text-white' : 'border border-[#EAE1D8] bg-white text-[#5A5147]'
      }`}
    >
      {children}
    </button>
  );
}
