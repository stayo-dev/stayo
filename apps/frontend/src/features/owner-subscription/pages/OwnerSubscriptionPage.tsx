import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Download, FileText, Landmark, Loader2, ShieldCheck } from 'lucide-react';
import { MoreScreenHeader } from '@features/owner-more/components/MoreScreenHeader';
import { ownerSubscriptionApi } from '../api';
import {
  useCancelDowngrade,
  useOwnerSubscription,
  usePaymentContext,
  useScheduleDowngrade,
  useSubmitSubscriptionPayment,
  useSubscriptionPlans,
  useUpgradePreview,
} from '../hooks/useOwnerSubscription';
import type { PaymentMethod, PlanSummary, SubscriptionInvoice } from '../api';
import {
  buildPlanCards,
  canBuyMoreExtraBeds,
  capacityLabel,
  deriveCapacityView,
  deriveStatusView,
  downgradeNotice,
  formatDate,
  formatMonthlyPrice,
  formatPaise,
  formatPeriod,
  hasOpenPayment,
  initialExtraBedsForSelection,
  mapBackendError,
  needsPaymentAction,
  openPayment,
  paymentMethodLabel,
  paymentStatusView,
  pendingDowngradeNotice,
  planRelation,
  invoiceRowView,
  remainingExtraBedAllowance,
  validatePaymentForm,
  type PlanRelation,
} from '../subscriptionView';

const card = 'overflow-hidden rounded-[14px] border border-border bg-card';
const field =
  'w-full rounded-[11px] border border-border bg-card px-3.5 py-2.5 text-[14px] text-foreground outline-none focus:border-primary';
const label = 'text-[12px] font-semibold text-muted-foreground';

const TONE_BG: Record<string, string> = {
  positive: 'bg-[#E6F0E8] text-[#3F7D58]',
  warning: 'bg-[#FBF0DC] text-[#8A6410]',
  critical: 'bg-destructive/10 text-destructive',
  info: 'bg-[#E4EEF5] text-[#2E5D77]',
  neutral: 'bg-muted text-muted-foreground',
};

export function OwnerSubscriptionPage() {
  const overviewQuery = useOwnerSubscription();
  const overview = overviewQuery.data;
  const sub = overview?.subscription;

  const statusView = sub ? deriveStatusView(sub) : null;
  // FOUNDING is auto-assigned to the first 10 owners and is never owner-selectable —
  // such an owner sees a fixed plan summary + payment step, not the plan picker.
  const isFoundingOwner = sub?.plan?.code === 'FOUNDING';
  const needsPayment = !!statusView && needsPaymentAction(statusView.status);
  const showPlanPicker = !!statusView && !isFoundingOwner && (needsPayment || statusView.status === 'ACTIVE');
  const showFoundingPayment = !!statusView && isFoundingOwner && needsPayment;

  const plansQuery = useSubscriptionPlans(showPlanPicker);
  const paymentCtxQuery = usePaymentContext(showPlanPicker || showFoundingPayment);

  const [selectedPlan, setSelectedPlan] = useState<PlanSummary | null>(null);
  // Extra beds requested for a NEW plan / the Founding payment (business
  // rules, 2026-09-10). Defaults to 0 for a fresh/NEW plan choice, but for a
  // genuine UPGRADE it carries the owner's CURRENT extra-bed count forward —
  // resetting it to 0 would silently drop already-paid recurring beds on
  // upgrade (Phase 6.6). The backend independently validates whatever count
  // ends up here against the target plan and rejects an incompatible one
  // (e.g. carrying 20 extra beds into Portfolio, which allows none) rather
  // than ever discarding it silently.
  const [extraBeds, setExtraBeds] = useState(0);
  const [pageError, setPageError] = useState<string | null>(null);
  const scheduleDowngrade = useScheduleDowngrade();
  const cancelDowngrade = useCancelDowngrade();
  const relation: PlanRelation | null = useMemo(() => {
    if (!selectedPlan || !sub) return null;
    return planRelation(sub.status, sub.plan?.id ?? null, sub.plan?.price_paise ?? null, selectedPlan);
  }, [selectedPlan, sub]);

  const selectPlan = (plan: PlanSummary | null) => {
    setSelectedPlan(plan);
    if (!plan || !sub) {
      setExtraBeds(0);
      return;
    }
    const rel = planRelation(sub.status, sub.plan?.id ?? null, sub.plan?.price_paise ?? null, plan);
    setExtraBeds(initialExtraBedsForSelection(rel, sub.extra_beds ?? 0));
  };

  const upgradePreviewQuery = useUpgradePreview(relation === 'UPGRADE' ? selectedPlan?.id ?? null : null, extraBeds);

  if (overviewQuery.isLoading) {
    return (
      <Shell>
        <p className="text-[13px] text-muted-foreground">Loading your subscription…</p>
      </Shell>
    );
  }
  if (overviewQuery.isError || !overview || !sub || !statusView) {
    return (
      <Shell>
        <p className="rounded-xl bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-medium text-destructive" role="alert">
          {mapBackendError(overviewQuery.error, "Couldn't load your subscription. Please try again.")}
        </p>
      </Shell>
    );
  }

  const capacity = deriveCapacityView(overview.usage);
  const openPmt = openPayment(overview.payments);
  const paymentsPending = hasOpenPayment(overview.payments);
  const plans = plansQuery.data?.plans ?? [];
  const planCards = buildPlanCards(plans, sub);

  // A synthetic PlanSummary for the auto-assigned FOUNDING plan, so the shared
  // PaymentPanel can bill it without it ever appearing in the plan picker.
  const foundingPlan: PlanSummary | null =
    isFoundingOwner && sub.plan
      ? {
          id: sub.plan.id,
          code: sub.plan.code,
          name: sub.plan.name,
          price_paise: sub.plan.price_paise,
          currency: sub.plan.currency,
          billing_cycle: 'MONTHLY',
          capacity_min: 1,
          capacity_max: sub.plan.capacity_max,
          included_beds: sub.plan.included_beds,
          max_extra_beds: sub.plan.max_extra_beds,
          extra_bed_price_paise: sub.plan.extra_bed_price_paise,
          is_public: false,
        }
      : null;

  const statusBody =
    isFoundingOwner && statusView.status === 'PENDING_PAYMENT'
      ? 'Submit your payment to activate your Founding plan. An admin verifies it, then your subscription activates.'
      : statusView.body;

  // Amount payable for the selected plan: the prorated figure for an upgrade
  // (backend, already includes extra-bed cost), otherwise the plan's monthly
  // price plus extra beds at their listed per-bed price (business rules,
  // 2026-09-10) — display only; the backend independently validates
  // `extra_beds` against the plan's allowance on submit.
  const amountPaise =
    relation === 'UPGRADE'
      ? upgradePreviewQuery.data?.amount_paise ?? null
      : selectedPlan != null
        ? selectedPlan.price_paise + extraBeds * (selectedPlan.extra_bed_price_paise ?? 0)
        : null;

  return (
    <Shell>
      <MoreScreenHeader
        backTo="/owner/more"
        backLabel="Profile"
        title="Subscription"
        subtitle="Your Stayo plan, payments and invoices"
      />

      {/* ── Status ─────────────────────────────────────────────────── */}
      <section className={card}>
        <div className="flex items-start gap-3 px-4 py-4">
          <StatusIcon tone={statusView.tone} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-bold text-foreground">{statusView.headline}</h2>
              <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${TONE_BG[statusView.tone]}`}>
                {statusView.label}
              </span>
            </div>
            <p className="mt-1 text-[12.5px] leading-[1.55] text-muted-foreground">{statusBody}</p>
          </div>
        </div>
      </section>

      {/* ── Current plan (ACTIVE) ──────────────────────────────────── */}
      {sub.status === 'ACTIVE' && sub.plan && (
        <section className={`${card} p-4`}>
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Current plan</p>
              <p className="mt-0.5 text-[17px] font-extrabold text-foreground">{sub.plan.name}</p>
            </div>
            <p className="text-[14px] font-bold text-foreground">{formatMonthlyPrice(sub.plan.price_paise, sub.plan.code)}</p>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
            <Row k="Billing period" v={formatPeriod(sub.current_period_start, sub.current_period_end)} />
            <Row k="Next renewal" v={formatDate(sub.next_renewal_at)} />
            <Row k="Payment status" v={paymentsPending ? 'Under review' : 'Paid'} />
            <Row k="Started" v={formatDate(sub.started_at)} />
            {sub.plan.included_beds != null && <Row k="Included beds" v={String(sub.plan.included_beds)} />}
            {sub.extra_beds > 0 && (
              <Row
                k="Extra beds"
                v={`${sub.extra_beds} (${formatPaise((sub.plan.extra_bed_price_paise ?? 0) * sub.extra_beds)}/mo)`}
              />
            )}
            {sub.plan.included_beds != null && (
              <Row
                k="Effective capacity"
                v={
                  sub.plan.max_extra_beds == null
                    ? `${sub.plan.included_beds + sub.extra_beds}+ (no ceiling)`
                    : String(sub.plan.included_beds + sub.extra_beds)
                }
              />
            )}
          </dl>
        </section>
      )}

      {/* ── Usage / capacity ──────────────────────────────────────── */}
      {capacity && (
        <section className={`${card} p-4`}>
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Active tenants</p>
            <p className="text-[15px] font-extrabold text-foreground">{capacity.text}</p>
          </div>
          {!capacity.unlimited && capacity.ratio != null && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${
                  capacity.state === 'at_limit' ? 'bg-destructive' : capacity.state === 'approaching' ? 'bg-[#C8901F]' : 'bg-primary'
                }`}
                style={{ width: `${Math.min(100, Math.round(capacity.ratio * 100))}%` }}
              />
            </div>
          )}
          {capacity.message && (
            <p
              className={`mt-2.5 flex items-start gap-2 rounded-xl px-3 py-2 text-[12px] font-medium ${
                capacity.state === 'at_limit' ? TONE_BG.critical : TONE_BG.warning
              }`}
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" strokeWidth={2.2} />
              {capacity.message}
            </p>
          )}
        </section>
      )}

      {/* ── Pending downgrade ─────────────────────────────────────── */}
      {sub.pending_plan && (
        <div className={`flex flex-col gap-2 rounded-xl px-3.5 py-2.5 ${TONE_BG.info}`}>
          <p className="flex items-start gap-2 text-[12.5px] font-medium">
            <Clock className="mt-0.5 h-4 w-4 flex-none" strokeWidth={2} />
            {pendingDowngradeNotice(sub.pending_plan.name, sub.current_period_end)}
          </p>
          <button
            type="button"
            disabled={cancelDowngrade.isPending}
            onClick={() => {
              setPageError(null);
              cancelDowngrade.mutate(undefined, { onError: (e) => setPageError(mapBackendError(e)) });
            }}
            className="w-fit text-[11.5px] font-bold uppercase tracking-wide underline disabled:opacity-50"
          >
            {cancelDowngrade.isPending ? 'Cancelling…' : 'Cancel scheduled change'}
          </button>
        </div>
      )}
      {pageError && (
        <p className="rounded-xl bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-medium text-destructive" role="alert">
          {pageError}
        </p>
      )}

      {/* ── Payment under review ──────────────────────────────────── */}
      {paymentsPending && openPmt && (
        <section className={`${card} p-4`}>
          <p className="flex items-center gap-2 text-[13.5px] font-semibold text-foreground">
            <Clock className="h-4 w-4 flex-none text-[#8A6410]" strokeWidth={2} />
            Payment submitted — under review
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {formatPaise(openPmt.amount_paise)} · {paymentMethodLabel(openPmt.payment_method)} · submitted {formatDate(openPmt.submitted_at)}.
            An admin verifies it and your subscription updates automatically. You can't submit another payment until this is reviewed.
          </p>
        </section>
      )}

      {/* ── Founding plan (auto-assigned) + payment ───────────────── */}
      {showFoundingPayment && foundingPlan && (
        <section className="flex flex-col gap-2.5">
          <h2 className="pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Your plan
          </h2>
          <div className="flex flex-col items-start gap-1 rounded-[13px] border border-border bg-card px-4 py-3.5">
            <div className="flex w-full items-baseline justify-between">
              <span className="text-[14px] font-bold text-foreground">
                {foundingPlan.name}
                <span className="ml-2 rounded-full bg-[#F0E7DF] px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-[#8A6410]">
                  First 10 owners
                </span>
              </span>
              <span className="text-[13px] font-bold text-foreground">
                {formatMonthlyPrice(foundingPlan.price_paise, foundingPlan.code)}
              </span>
            </div>
            <span className="text-[11.5px] text-muted-foreground">{capacityLabel(foundingPlan)}</span>
          </div>

          {!paymentsPending && (
            <PaymentPanel
              plan={foundingPlan}
              relation="NEW"
              amountPaise={foundingPlan.price_paise + extraBeds * (foundingPlan.extra_bed_price_paise ?? 0)}
              amountLoading={false}
              amountError={null}
              upgradePreview={null}
              periodEnd={sub.current_period_end}
              paymentContext={paymentCtxQuery.data ?? null}
              paymentsPending={paymentsPending}
              extraBeds={extraBeds}
              onExtraBedsChange={setExtraBeds}
              onDone={() => undefined}
            />
          )}
        </section>
      )}

      {/* ── Plans + payment ───────────────────────────────────────── */}
      {showPlanPicker && (
        <section className="flex flex-col gap-2.5">
          <h2 className="pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {sub.status === 'ACTIVE' ? 'Change plan' : 'Choose a plan'}
          </h2>

          {plansQuery.isLoading && <p className="text-[12.5px] text-muted-foreground">Loading plans…</p>}
          {plansQuery.isError && (
            <p className="text-[12.5px] text-destructive">{mapBackendError(plansQuery.error, "Couldn't load plans.")}</p>
          )}

          {planCards.map((pc) => {
            const plan = plans.find((p) => p.id === pc.id)!;
            const isSelected = selectedPlan?.id === pc.id;
            return (
              <button
                key={pc.id}
                type="button"
                disabled={pc.isCurrent || paymentsPending}
                onClick={() => selectPlan(isSelected ? null : plan)}
                className={`flex flex-col items-start gap-1 rounded-[13px] border px-4 py-3.5 text-left transition-colors ${
                  isSelected ? 'border-primary bg-primary/[0.04]' : 'border-border bg-card'
                } ${pc.isCurrent || paymentsPending ? 'opacity-60' : 'hover:border-primary/50'}`}
              >
                <div className="flex w-full items-baseline justify-between">
                  <span className="text-[14px] font-bold text-foreground">{pc.name}</span>
                  <span className="text-[13px] font-bold text-foreground">{pc.priceLabel}</span>
                </div>
                <span className="text-[11.5px] text-muted-foreground">{pc.capacityLabel}</span>
                <RelationTag pc={pc} />
              </button>
            );
          })}

          {/* Downgrade is SCHEDULED, not paid — a dedicated confirm, never the payment panel. */}
          {selectedPlan && relation === 'DOWNGRADE' && (
            <div className={`${card} mt-1 flex flex-col gap-3 p-4`}>
              <p className="text-[13px] font-bold text-foreground">Switch to {selectedPlan.name}</p>
              <p className={`rounded-xl px-3 py-2 text-[12px] font-medium ${TONE_BG.info}`}>
                {downgradeNotice(selectedPlan.name, sub.current_period_end)}
              </p>
              <p className="text-[11.5px] text-muted-foreground">No payment is required now. The change is applied automatically at your next renewal.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={scheduleDowngrade.isPending}
                  onClick={() => {
                    setPageError(null);
                    scheduleDowngrade.mutate(selectedPlan.id, {
                      onSuccess: () => selectPlan(null),
                      onError: (e) => setPageError(mapBackendError(e)),
                    });
                  }}
                  className="rounded-[11px] bg-primary px-4 py-2.5 text-[13.5px] font-bold text-primary-foreground disabled:opacity-50"
                >
                  {scheduleDowngrade.isPending ? 'Scheduling…' : 'Schedule downgrade'}
                </button>
                <button
                  type="button"
                  onClick={() => selectPlan(null)}
                  className="rounded-[11px] border border-border px-4 py-2.5 text-[13.5px] font-semibold text-foreground"
                >
                  Keep current plan
                </button>
              </div>
            </div>
          )}

          {selectedPlan && relation && relation !== 'DOWNGRADE' && relation !== 'CURRENT' && (
            <PaymentPanel
              key={selectedPlan.id}
              plan={selectedPlan}
              relation={relation}
              amountPaise={amountPaise}
              amountLoading={relation === 'UPGRADE' && upgradePreviewQuery.isLoading}
              amountError={
                relation === 'UPGRADE' && upgradePreviewQuery.isError
                  ? mapBackendError(upgradePreviewQuery.error, 'Could not work out the upgrade amount.')
                  : null
              }
              upgradePreview={relation === 'UPGRADE' ? upgradePreviewQuery.data ?? null : null}
              periodEnd={sub.current_period_end}
              paymentContext={paymentCtxQuery.data ?? null}
              paymentsPending={paymentsPending}
              extraBeds={extraBeds}
              onExtraBedsChange={setExtraBeds}
              onDone={() => selectPlan(null)}
            />
          )}
        </section>
      )}

      {/* ── Payment history ───────────────────────────────────────── */}
      <HistorySection title="Payment history" empty="No payments yet.">
        {overview.payments.map((p) => {
          const sv = paymentStatusView(p.status);
          return (
            <div key={p.id} className="flex flex-col gap-0.5 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-foreground">{formatPaise(p.amount_paise)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${TONE_BG[sv.tone]}`}>{sv.label}</span>
              </div>
              <span className="text-[11.5px] text-muted-foreground">
                {formatDate(p.submitted_at)} · {paymentMethodLabel(p.payment_method)}
                {p.extra_beds > 0 ? ` · +${p.extra_beds} extra beds` : ''}
                {p.transaction_reference ? ` · ${p.transaction_reference}` : ''}
              </span>
              {p.status === 'REJECTED' && p.rejection_reason && (
                <span className="mt-0.5 rounded-lg bg-destructive/10 px-2 py-1 text-[11.5px] text-destructive">
                  Rejected: {p.rejection_reason}
                </span>
              )}
            </div>
          );
        })}
      </HistorySection>

      {/* ── Invoices ──────────────────────────────────────────────── */}
      <HistorySection title="Invoices" empty="No invoices yet.">
        {overview.invoices.map((inv) => (
          <InvoiceRow key={inv.id} inv={inv} />
        ))}
      </HistorySection>
    </Shell>
  );
}

function InvoiceRow({ inv }: { inv: SubscriptionInvoice }) {
  const view = invoiceRowView(inv);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await ownerSubscriptionApi.downloadInvoice(inv.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || view.downloadFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(mapBackendError(e, "Couldn't download that invoice. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <FileText className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] font-semibold text-foreground">{view.invoiceNumber}</span>
          <span className="text-[12.5px] font-semibold text-foreground">{view.amountLabel}</span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {view.planLabel} · {view.periodLabel} · issued {view.issuedLabel} · {view.methodLabel}
          {view.extraBedsLabel ? ` · ${view.extraBedsLabel}` : ''}
        </span>
        {view.extraBedAmountLabel && (
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            Plan {view.planAmountLabel} + extra beds {view.extraBedAmountLabel}
          </span>
        )}
        <div className="mt-1">
          <button
            type="button"
            onClick={download}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <Download className="h-3.5 w-3.5" strokeWidth={2} />}
            {busy ? 'Preparing…' : 'Download'}
          </button>
          {view.documentState === 'pending' && !busy && (
            <span className="ml-2 text-[11px] text-muted-foreground">Generated on first download</span>
          )}
        </div>
        {error && <span className="mt-1 block text-[11px] text-destructive">{error}</span>}
      </div>
    </div>
  );
}

// ── sub-components ─────────────────────────────────────────────────────────
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 px-4 pb-16 pt-6 sm:px-6 lg:mx-auto lg:w-full lg:max-w-[760px] lg:px-0 lg:pt-8">
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-semibold text-foreground">{v}</dd>
    </>
  );
}

function StatusIcon({ tone }: { tone: string }) {
  if (tone === 'positive') return <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-[#3F7D58]" strokeWidth={2} />;
  if (tone === 'critical') return <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-destructive" strokeWidth={2} />;
  return <Clock className="mt-0.5 h-5 w-5 flex-none text-[#8A6410]" strokeWidth={2} />;
}

function RelationTag({ pc }: { pc: { relation: PlanRelation; isPending: boolean } }) {
  if (pc.isPending) {
    return <span className="text-[10.5px] font-bold uppercase text-[#2E5D77]">Scheduled from next period</span>;
  }
  const map: Partial<Record<PlanRelation, string>> = {
    CURRENT: 'Current plan',
    UPGRADE: 'Upgrade',
    DOWNGRADE: 'Downgrade — next renewal',
  };
  const text = map[pc.relation];
  return text ? <span className="text-[10.5px] font-bold uppercase text-primary">{text}</span> : null;
}

function HistorySection({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(items) ? items.length === 0 : !items;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className={card}>
        {isEmpty ? (
          <p className="px-4 py-3 text-[12.5px] text-muted-foreground">{empty}</p>
        ) : (
          <div className="divide-y divide-border/60">{items}</div>
        )}
      </div>
    </section>
  );
}

function PaymentPanel({
  plan,
  relation,
  amountPaise,
  amountLoading,
  amountError,
  upgradePreview,
  periodEnd,
  paymentContext,
  paymentsPending,
  extraBeds,
  onExtraBedsChange,
  onDone,
}: {
  plan: PlanSummary;
  relation: PlanRelation;
  amountPaise: number | null;
  amountLoading: boolean;
  amountError: string | null;
  upgradePreview: import('../api').UpgradePreview | null;
  periodEnd: string | null;
  paymentContext: import('../api').PaymentContext | null;
  paymentsPending: boolean;
  /** Extra beds requested beyond `plan.included_beds` (business rules, 2026-09-10). */
  extraBeds: number;
  onExtraBedsChange: (value: number) => void;
  onDone: () => void;
}) {
  const submit = useSubmitSubscriptionPayment();
  const methods = paymentContext?.methods ?? ['UPI_MANUAL', 'CASH'];
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [reference, setReference] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const disabled = paymentsPending || submit.isPending;
  const maxExtraBeds = remainingExtraBedAllowance(plan, 0);
  const canAddExtraBeds = canBuyMoreExtraBeds(plan, 0);

  const onSubmit = () => {
    setFormError(null);
    if (amountPaise == null) {
      setFormError('The amount payable is still loading.');
      return;
    }
    const check = validatePaymentForm({
      method,
      amountPaise,
      transactionReference: reference,
      proofFileUrl: proofFile ? 'pending-upload' : null,
    });
    if (check.ok !== true) {
      setFormError('reason' in check ? check.reason : 'Please check the payment details.');
      return;
    }
    submit.mutate(
      {
        input: {
          plan_id: plan.id,
          amount_paise: amountPaise,
          payment_method: method as PaymentMethod,
          transaction_reference: reference.trim() || undefined,
          extra_beds: extraBeds || undefined,
        },
        proofFile,
      },
      {
        onSuccess: () => onDone(),
        onError: (err) => setFormError(mapBackendError(err)),
      },
    );
  };

  return (
    <div className={`${card} mt-1 flex flex-col gap-3 p-4`}>
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] font-bold text-foreground">{plan.name}</p>
        <p className="text-[13px] font-bold text-foreground">
          {amountLoading ? 'Calculating…' : amountPaise != null ? formatPaise(amountPaise) : '—'}
        </p>
      </div>

      {relation === 'DOWNGRADE' && (
        <p className={`rounded-xl px-3 py-2 text-[12px] font-medium ${TONE_BG.info}`}>
          {downgradeNotice(plan.name, periodEnd)}
        </p>
      )}
      {relation === 'UPGRADE' && upgradePreview && (
        <p className="rounded-xl bg-muted px-3 py-2 text-[11.5px] leading-[1.5] text-muted-foreground">
          Prorated for the {upgradePreview.days_remaining} days left in your current period. Takes effect immediately once
          approved; from {formatDate(upgradePreview.effective === 'IMMEDIATELY_ON_APPROVAL' ? periodEnd : periodEnd)} you pay{' '}
          {formatPaise(upgradePreview.next_renewal_price_paise)}/month.
        </p>
      )}
      {amountError && <p className="text-[12px] font-medium text-destructive">{amountError}</p>}

      {/* extra beds (business rules, 2026-09-10) — validated server-side on submit */}
      {canAddExtraBeds && relation !== 'DOWNGRADE' && (
        <label className="flex flex-col gap-1.5">
          <span className={label}>
            Extra beds{' '}
            <span className="font-normal normal-case text-muted-foreground">
              ({formatPaise(plan.extra_bed_price_paise ?? 0)}/bed
              {maxExtraBeds != null ? `, up to ${maxExtraBeds}` : ', no limit'})
            </span>
          </span>
          <input
            type="number"
            min={0}
            max={maxExtraBeds ?? undefined}
            step={1}
            className={field}
            value={extraBeds || ''}
            placeholder="0"
            disabled={disabled}
            onChange={(e) => {
              const raw = Number(e.target.value);
              const clamped = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
              onExtraBedsChange(maxExtraBeds != null ? Math.min(clamped, maxExtraBeds) : clamped);
            }}
          />
          {maxExtraBeds != null && extraBeds >= maxExtraBeds && (
            <span className="text-[11px] text-muted-foreground">
              That's the most extra beds {plan.name} allows. Need more capacity? Upgrade to the next plan.
            </span>
          )}
        </label>
      )}

      {/* method */}
      <div className="flex flex-col gap-1.5">
        <span className={label}>Payment method</span>
        <div className="flex gap-2">
          {methods.map((m) => (
            <button
              key={m}
              type="button"
              disabled={disabled}
              onClick={() => setMethod(m)}
              className={`flex-1 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${
                method === m ? 'border-primary bg-primary/[0.05] text-primary' : 'border-border text-foreground'
              }`}
            >
              {paymentMethodLabel(m)}
            </button>
          ))}
        </div>
      </div>

      {/* UPI payee + reference + proof */}
      {method === 'UPI_MANUAL' && (
        <>
          <div className={`flex items-start gap-2.5 rounded-xl bg-muted px-3 py-2.5`}>
            <Landmark className="mt-0.5 h-4 w-4 flex-none text-primary" strokeWidth={2} />
            <div className="min-w-0 text-[11.5px] leading-[1.5] text-muted-foreground">
              {paymentContext?.payee_configured && paymentContext.payee ? (
                <>
                  <p className="font-semibold text-foreground">
                    {paymentContext.payee.account_name || 'Stayo'}
                    {paymentContext.payee.upi_vpa ? ` · ${paymentContext.payee.upi_vpa}` : ''}
                  </p>
                  {paymentContext.payee.qr_image_url && (
                    <img
                      src={paymentContext.payee.qr_image_url}
                      alt="Stayo payment QR"
                      className="mt-2 h-36 w-36 rounded-lg border border-border object-contain"
                    />
                  )}
                  {paymentContext.payee.note && <p className="mt-1">{paymentContext.payee.note}</p>}
                </>
              ) : (
                <p>
                  Stayo&apos;s UPI payment details are being set up. Please contact Stayo for where to send this payment, then
                  submit your reference and screenshot below.
                </p>
              )}
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className={label}>Transaction / UTR reference</span>
            <input
              className={field}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. 412345678901"
              disabled={disabled}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={label}>Payment screenshot</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
              disabled={disabled}
              className="text-[12px] text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-foreground"
            />
          </label>
        </>
      )}

      {method === 'CASH' && (
        <p className="rounded-xl bg-muted px-3 py-2 text-[11.5px] text-muted-foreground">
          Record the cash payment reference you were given by Stayo, then submit. An admin confirms it.
        </p>
      )}
      {method === 'CASH' && (
        <label className="flex flex-col gap-1.5">
          <span className={label}>Reference (optional)</span>
          <input
            className={field}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="CASH-…"
            disabled={disabled}
          />
        </label>
      )}

      {formError && (
        <p className="rounded-xl bg-destructive/10 px-3 py-2 text-[12px] font-medium text-destructive" role="alert">
          {formError}
        </p>
      )}

      <button
        type="button"
        disabled={disabled || !method || amountPaise == null}
        onClick={onSubmit}
        className="rounded-[11px] bg-primary px-4 py-2.5 text-[13.5px] font-bold text-primary-foreground disabled:opacity-50"
      >
        {submit.isPending ? 'Submitting…' : 'Submit payment'}
      </button>
      <p className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 flex-none" strokeWidth={2} />
        Your payment is verified by a Stayo admin before your subscription changes.
      </p>
    </div>
  );
}
