import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformAdminService } from '@features/platform-admin/api';
import { DataTable, EmptyState, FilterChips, SegmentedTabs, StatCard, type DataColumn } from '../ui';
import { useToast } from '../layout/toastContext';
import {
  adminError,
  availableActions,
  canActivateFounding,
  capacityText,
  formatDate,
  formatPaise,
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

// ── Subscriptions list + actions ──────────────────────────────────────────
function SubscriptionsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('ALL');
  // Founding / Starter / Growth / Professional / Portfolio (business rules, 2026-09-10).
  const [planCode, setPlanCode] = useState('ALL');
  const [search, setSearch] = useState('');

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
      toast(okMsg, 'ok');
    } catch (e) {
      toast(adminError(e), 'no');
    }
  };

  const doPause = (id: string) => {
    const reason = window.prompt('Reason for pausing this subscription:')?.trim();
    if (!reason) return toast('A reason is required', 'no');
    if (!window.confirm('Pause this subscription? The owner will lose platform access.')) return;
    run(() => platformAdminService.pauseSubscription(id, reason), 'Subscription paused');
  };
  const doResume = (id: string) => {
    const reason = window.prompt('Reason for resuming:')?.trim();
    if (!reason) return toast('A reason is required', 'no');
    run(
      () => platformAdminService.resumeSubscription(id, reason),
      'Resumed — owner is now PENDING_PAYMENT (they must pay, or use Extend to grant access)',
    );
  };
  const doExtend = (id: string) => {
    const daysStr = window.prompt('Extend access by how many days? (1–30)');
    const days = Number(daysStr);
    if (!Number.isInteger(days) || days < 1 || days > 30) return toast('Enter a whole number of days, 1–30', 'no');
    const reason = window.prompt('Reason for the extension:')?.trim();
    if (!reason) return toast('A reason is required', 'no');
    run(() => platformAdminService.extendSubscription(id, { days, reason }), `Access extended ${days} day(s)`);
  };
  // Extra beds (business rules, 2026-09-10) — the backend validates the count
  // against the plan's allowance regardless of what's typed here.
  const promptExtraBeds = (plan: any): number | undefined => {
    const allowance =
      plan.max_extra_beds == null ? 'no limit' : plan.max_extra_beds === 0 ? 'not offered on this plan' : `up to ${plan.max_extra_beds}`;
    const raw = window.prompt(`Extra beds beyond the ${plan.included_beds ?? '—'} included (${allowance}, ₹${(plan.extra_bed_price_paise ?? 0) / 100}/bed)? Leave blank for 0.`);
    if (!raw || !raw.trim()) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  };

  const doChangePlan = (id: string) => {
    const codes = plans.map((p: any) => p.code).join(', ');
    const code = window.prompt(`New plan code (${codes}):`)?.trim().toUpperCase();
    const plan = plans.find((p: any) => p.code === code);
    if (!plan) return toast('Unknown plan code', 'no');
    const effective = window.confirm('OK = apply IMMEDIATELY. Cancel = apply at NEXT_PERIOD.')
      ? 'IMMEDIATE'
      : 'NEXT_PERIOD';
    const extraBeds = effective === 'IMMEDIATE' ? promptExtraBeds(plan) : undefined;
    const reason = window.prompt('Reason for the plan change:')?.trim();
    if (!reason) return toast('A reason is required', 'no');
    run(
      () => platformAdminService.changeSubscriptionPlan(id, { plan_id: plan.id, effective, reason, extra_beds: extraBeds }),
      `Plan change (${effective}) recorded`,
    );
  };
  const doCash = (row: any) => {
    const codes = plans.map((p: any) => p.code).join(', ');
    const code = window.prompt(`Cash payment — plan code (${codes}):`)?.trim().toUpperCase();
    const plan = plans.find((p: any) => p.code === code);
    if (!plan) return toast('Unknown plan code', 'no');
    const extraBeds = promptExtraBeds(plan);
    const extraCostPaise = (extraBeds ?? 0) * (plan.extra_bed_price_paise ?? 0);
    const defaultRupees = (plan.price_paise + extraCostPaise) / 100;
    const amtStr = window.prompt(
      `Amount in ₹ (plan ${formatPaise(plan.price_paise)}${extraBeds ? ` + ${extraBeds} extra beds` : ''}):`,
      String(defaultRupees),
    );
    const rupees = Number(amtStr);
    if (!Number.isFinite(rupees) || rupees <= 0) return toast('Enter a valid amount', 'no');
    const reference = window.prompt('Cash reference / note (optional):')?.trim() || undefined;
    if (!window.confirm(`Record a CASH payment of ₹${rupees} for ${row.owner?.name ?? 'this owner'}? It will be SUBMITTED for your review.`)) return;
    run(async () => {
      const created = await platformAdminService.recordCashSubscriptionPayment({
        owner_id: row.owner.id,
        plan_id: plan.id,
        amount_paise: Math.round(rupees * 100),
        reference,
        extra_beds: extraBeds,
      });
      if (window.confirm('Cash payment recorded as SUBMITTED. Approve it now?')) {
        await platformAdminService.approveSubscriptionPayment(created.id);
      }
    }, 'Cash payment recorded');
  };
  const doActivateFounding = (row: any) => {
    // Server-computed from LIVE active-bed usage (business rules, 2026-09-12) —
    // never the flat plan price alone, in case the owner already has active
    // tenants past the 250 included beds at the moment of first activation.
    const amount = formatPaise(row.founding_calculated_amount_paise ?? row.plan?.price_paise ?? row.amount_paise);
    if (
      !window.confirm(
        `Mark as Paid & Activate?\n\nOwner: ${row.owner?.name ?? row.owner?.id}\nFounding Partner #${row.founding_partner_number ?? '—'}\nActive beds: ${row.usage?.used ?? 0} (${row.plan?.included_beds ?? 250} included, ₹${(row.plan?.extra_bed_price_paise ?? 1000) / 100}/extra bed)\nAmount to activate: ${amount}\n\nOnly confirm once the client has actually paid ${amount} outside Stayo. This activates a one-month subscription immediately.`,
      )
    )
      return;
    const reference = window.prompt('Payment reference / note (optional):')?.trim() || undefined;
    run(
      () => platformAdminService.activateFoundingSubscription(row.id, reference),
      'Founding Partner subscription activated',
    );
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
          className="ml-auto w-full max-w-[280px] rounded-[10px] border border-[#EAE1D8] bg-white px-3 py-2 text-[12.5px] outline-none focus:border-[#221E1A]"
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
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-semibold text-[#221E1A]">{row.owner?.name ?? '—'}</div>
                    <div className="truncate text-[11px] text-[#8A7F75]">{row.owner?.email ?? row.owner?.phone ?? ''}</div>
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
              case 'actions': {
                const acts = availableActions(row.status);
                return (
                  <div className="flex flex-wrap gap-1">
                    {canActivateFounding(row.status, row.plan?.code) && (
                      <ActBtn onClick={() => doActivateFounding(row)} primary>
                        Mark as Paid & Activate
                      </ActBtn>
                    )}
                    {acts.includes('pause') && <ActBtn onClick={() => doPause(row.id)}>Pause</ActBtn>}
                    {acts.includes('resume') && <ActBtn onClick={() => doResume(row.id)}>Resume</ActBtn>}
                    {acts.includes('extend') && <ActBtn onClick={() => doExtend(row.id)}>Extend</ActBtn>}
                    {acts.includes('change-plan') && <ActBtn onClick={() => doChangePlan(row.id)}>Plan</ActBtn>}
                    {acts.includes('cash') && <ActBtn onClick={() => doCash(row)}>Cash</ActBtn>}
                  </div>
                );
              }
              default:
                return null;
            }
          }}
        />
      )}
    </div>
  );
}

// ── Payment review queue ──────────────────────────────────────────────────
function PaymentQueueTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState('REVIEWABLE');

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

  const approve = useMutation({
    mutationFn: (id: string) => platformAdminService.approveSubscriptionPayment(id),
    onSuccess: (res) => {
      refresh();
      toast(`Approved — subscription is now ${res.subscription?.status ?? 'updated'}${res.invoice?.invoice_number ? `, invoice ${res.invoice.invoice_number}` : ''}`, 'ok');
    },
    onError: (e) => toast(adminError(e), 'no'),
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => platformAdminService.rejectSubscriptionPayment(id, reason),
    onSuccess: () => {
      refresh();
      toast('Payment rejected — the owner is told the reason and can resubmit', 'ok');
    },
    onError: (e) => toast(adminError(e), 'no'),
  });

  const onApprove = (row: any) => {
    if (
      window.confirm(
        `Approve this payment?\n\nOwner: ${row.owner?.name ?? row.owner?.id}\nPlan: ${row.plan?.name ?? row.plan?.code}${row.extra_beds > 0 ? ` (+${row.extra_beds} extra beds)` : ''}\nAmount: ${formatPaise(row.amount_paise)}\nMethod: ${paymentMethodLabel(row.payment_method)}\nRef: ${row.transaction_reference ?? '—'}\n\nThis runs the atomic backend transaction: payment → APPROVED, subscription activated/updated, invoice issued.`,
      )
    ) {
      approve.mutate(row.id);
    }
  };
  const onReject = (row: any) => {
    const reason = window.prompt('Reason for rejecting (shown to the owner):')?.trim();
    if (!reason) return toast('A reason is required to reject', 'no');
    reject.mutate({ id: row.id, reason });
  };

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
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-semibold text-[#221E1A]">{row.owner?.name ?? '—'}</div>
                    <div className="truncate text-[11px] text-[#8A7F75]">{row.owner?.email ?? ''}</div>
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
                if (isReviewablePayment(row.status)) {
                  return (
                    <div className="flex gap-1">
                      <ActBtn onClick={() => onApprove(row)} primary>
                        Approve
                      </ActBtn>
                      <ActBtn onClick={() => onReject(row)}>Reject</ActBtn>
                    </div>
                  );
                }
                return row.invoice ? (
                  <ActBtn onClick={() => downloadInvoice.mutate(row.invoice.id)}>
                    {downloadInvoice.isPending ? 'Preparing…' : 'Invoice'}
                  </ActBtn>
                ) : null;
              default:
                return null;
            }
          }}
        />
      )}
      <p className="text-[11px] text-[#8A7F75]">
        Approval/rejection is the existing Phase 2 backend transaction — the UI never duplicates that logic. A payment can be
        reviewed once; a second attempt returns a clear error.
      </p>
      <StatsRow />
    </div>
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
