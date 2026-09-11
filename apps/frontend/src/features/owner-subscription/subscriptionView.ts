/**
 * Pure view logic for the owner billing page (ADR-172, Phase 4).
 *
 * Every business value — price, proration, plan eligibility, capacity — comes
 * from the backend. This module only shapes what's already been returned into
 * labels, tones and validation the component renders. No network, no `Date.now`
 * beyond a passed-in `now`. Tested directly (node env, no DOM).
 */
import type {
  OwnerSubscription,
  PaymentMethod,
  PaymentStatus,
  PlanSummary,
  SubscriptionInvoice,
  SubscriptionPayment,
  SubscriptionStatus,
  SubscriptionUsage,
} from './api';

export type Tone = 'positive' | 'warning' | 'critical' | 'neutral' | 'info';

// ── money ─────────────────────────────────────────────────────────────────
export function formatPaise(paise: number | null | undefined): string {
  if (paise == null || Number.isNaN(paise)) return '—';
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function formatMonthlyPrice(paise: number, code?: string): string {
  const base = `${formatPaise(paise)}/month`;
  return code === 'PORTFOLIO' ? `${formatPaise(paise)}+/month` : base;
}

// ── dates ─────────────────────────────────────────────────────────────────
function d(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(value: string | null | undefined): string {
  const date = d(value);
  if (!date) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatPeriod(start: string | null, end: string | null): string {
  const s = d(start);
  const e = d(end);
  if (!s || !e) return '—';
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  const fmt = (date: Date, withYear: boolean) =>
    date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    });
  return `${fmt(s, !sameYear)} – ${fmt(e, true)}`;
}

// ── status ────────────────────────────────────────────────────────────────
export interface StatusView {
  status: SubscriptionStatus;
  label: string;
  tone: Tone;
  headline: string;
  body: string;
  /** The primary CTA to render, or null if none applies. */
  primaryAction: 'CHOOSE_PLAN' | 'RENEW' | 'CONTACT_STAYO' | null;
}

/** Renewal-proximity window (business rules, 2026-09-12) — inside this many days of `next_renewal_at`, an otherwise-ACTIVE subscription shows an "ending soon" warning instead of the plain positive state. Does NOT change `status` itself — only PAUSED (written by `runExpirySweep`) is a real backend state change; this is purely a same-status warning derived from the date already on the row. */
const EXPIRING_SOON_WINDOW_DAYS = 7;

export function deriveStatusView(
  sub: Pick<OwnerSubscription, 'status' | 'next_renewal_at'>,
  now: Date = new Date(),
): StatusView {
  switch (sub.status) {
    case 'ACTIVE': {
      const renewal = sub.next_renewal_at ? new Date(sub.next_renewal_at) : null;
      const daysLeft = renewal ? Math.ceil((renewal.getTime() - now.getTime()) / 86_400_000) : null;
      const expiringSoon = daysLeft != null && daysLeft <= EXPIRING_SOON_WINDOW_DAYS && daysLeft >= 0;
      if (daysLeft === 1) {
        return {
          status: 'ACTIVE',
          label: 'Ending soon',
          tone: 'warning',
          headline: 'Your subscription expires tomorrow',
          body: 'Please renew to continue using Stayo.',
          primaryAction: 'RENEW',
        };
      }
      if (expiringSoon) {
        return {
          status: 'ACTIVE',
          label: 'Ending soon',
          tone: 'warning',
          headline: 'Your subscription is ending soon',
          body: `Your subscription expires on ${formatDate(sub.next_renewal_at)}. Please renew to continue using Stayo.`,
          primaryAction: 'RENEW',
        };
      }
      return {
        status: 'ACTIVE',
        label: 'Active',
        tone: 'positive',
        headline: 'Subscription active',
        body: sub.next_renewal_at
          ? `Renews on ${formatDate(sub.next_renewal_at)}.`
          : 'Your subscription is active.',
        primaryAction: null,
      };
    }
    case 'PENDING_PAYMENT':
      return {
        status: 'PENDING_PAYMENT',
        label: 'Payment required',
        tone: 'warning',
        headline: 'Payment required to start managing Stayo',
        body: 'Choose a plan and submit your payment. An admin verifies it, then your subscription activates.',
        primaryAction: 'CHOOSE_PLAN',
      };
    case 'PAUSED':
      // This IS the "expired" state in canonical Stayo terminology — the
      // lifecycle sweep (`runExpirySweep`) writes PAUSED, never EXPIRED, when
      // a paid period ends with no active admin override (business rules,
      // 2026-09-12 — reusing the existing state rather than introducing a
      // conflicting new one).
      return {
        status: 'PAUSED',
        label: 'Expired',
        tone: 'critical',
        headline: 'Your subscription has expired',
        body: 'Please renew your subscription to continue using Stayo. Your data, tenants and properties are safe.',
        primaryAction: 'RENEW',
      };
    case 'EXPIRED':
      return {
        status: 'EXPIRED',
        label: 'Expired',
        tone: 'critical',
        headline: 'Your subscription has ended',
        body: 'Renew to resume managing your hostels. Your data is safe.',
        primaryAction: 'RENEW',
      };
    case 'CANCELLED':
      return {
        status: 'CANCELLED',
        label: 'Cancelled',
        tone: 'neutral',
        headline: 'Your subscription is cancelled',
        body: 'Submit a payment for a plan to reactivate, or contact Stayo.',
        primaryAction: 'CHOOSE_PLAN',
      };
    case 'TRIAL':
    default:
      // Stayo has no trial period. A legacy TRIAL row is treated as "not yet
      // paid" — never presented as a fresh trial the owner can rely on.
      return {
        status: 'TRIAL',
        label: 'Payment required',
        tone: 'warning',
        headline: 'Payment required to start managing Stayo',
        body: 'Stayo does not run a trial. Choose a plan and submit your payment to activate.',
        primaryAction: 'CHOOSE_PLAN',
      };
  }
}

/** Does the owner need to act (choose plan / pay) rather than just view? */
export function needsPaymentAction(status: SubscriptionStatus): boolean {
  return status === 'PENDING_PAYMENT' || status === 'PAUSED' || status === 'EXPIRED' || status === 'TRIAL' || status === 'CANCELLED';
}

// ── capacity / usage ──────────────────────────────────────────────────────
export interface CapacityView {
  text: string; // "32 / 50" or "Unlimited"
  unlimited: boolean;
  ratio: number | null; // 0..1, null when unlimited
  state: 'unlimited' | 'ok' | 'approaching' | 'at_limit';
  message: string | null;
}

export function deriveCapacityView(usage: SubscriptionUsage | null): CapacityView | null {
  if (!usage) return null;
  if (usage.capacity_max == null) {
    return { text: 'Unlimited', unlimited: true, ratio: null, state: 'unlimited', message: null };
  }
  const cap = usage.capacity_max;
  const used = Math.max(0, usage.used);
  const ratio = cap > 0 ? used / cap : 1;
  const atLimit = usage.at_limit || used >= cap;
  const approaching = !atLimit && ratio >= 0.9;
  return {
    text: `${used} / ${cap}`,
    unlimited: false,
    ratio,
    state: atLimit ? 'at_limit' : approaching ? 'approaching' : 'ok',
    message: atLimit
      ? 'Plan capacity reached. Upgrade your plan to add more active tenants.'
      : approaching
        ? `You're close to your plan's limit of ${cap} active tenants.`
        : null,
  };
}

// ── plans ─────────────────────────────────────────────────────────────────
export interface PlanCardView {
  id: string;
  code: string;
  name: string;
  priceLabel: string; // "₹1,499/month"
  capacityLabel: string; // "1–50 active tenants" | "Unlimited"
  isCurrent: boolean;
  isPending: boolean;
  /** Relative to the current plan price: which action selecting this plan implies. */
  relation: PlanRelation;
}

export type PlanRelation = 'CURRENT' | 'NEW' | 'RENEWAL' | 'UPGRADE' | 'DOWNGRADE';

export function planRelation(
  status: SubscriptionStatus,
  currentPlanId: string | null,
  currentPricePaise: number | null,
  plan: Pick<PlanSummary, 'id' | 'price_paise'>,
): PlanRelation {
  if (status === 'ACTIVE' && plan.id === currentPlanId) return 'CURRENT';
  if (status !== 'ACTIVE' || currentPricePaise == null) return 'NEW';
  if (plan.price_paise > currentPricePaise) return 'UPGRADE';
  if (plan.price_paise < currentPricePaise) return 'DOWNGRADE';
  return 'RENEWAL';
}

/**
 * The extra-beds value the plan-selection form should start at when a plan is
 * picked (Phase 6.6). A genuine UPGRADE carries the owner's CURRENT extra-bed
 * count FORWARD — resetting it to 0 would silently drop already-paid
 * recurring beds the moment the owner upgrades, purely because the form
 * defaulted to 0. Every other relation (NEW/RENEWAL/DOWNGRADE/CURRENT) starts
 * fresh at 0: DOWNGRADE never uses this value at all (it's a scheduled,
 * unpaid change with no extra-bed input), and NEW/RENEWAL are a fresh
 * plan/payment where the owner opts in explicitly. The backend independently
 * validates whatever ends up here against the target plan and refuses an
 * incompatible count outright rather than ever discarding it.
 */
export function initialExtraBedsForSelection(
  relation: PlanRelation,
  currentExtraBeds: number,
): number {
  return relation === 'UPGRADE' ? Math.max(0, currentExtraBeds) : 0;
}

/**
 * Included-vs-extra-beds capacity label (business rules, 2026-09-10) — e.g.
 * "50 beds included, up to 10 extra @ ₹10/bed", "250 included, unlimited
 * extra beds (₹10/bed)" (FOUNDING), or "500 beds included" when the plan
 * doesn't offer extra beds yet (Portfolio — `max_extra_beds: 0`).
 * Falls back to the legacy min–max range when `included_beds` isn't present.
 */
export function capacityLabel(
  plan: Pick<PlanSummary, 'capacity_min' | 'capacity_max' | 'included_beds' | 'max_extra_beds' | 'extra_bed_price_paise'>,
): string {
  if (plan.included_beds == null) {
    if (plan.capacity_max == null) return 'Unlimited active tenants';
    const min = plan.capacity_min ?? 1;
    return `${min}–${plan.capacity_max} active tenants`;
  }
  const included = `${plan.included_beds} bed${plan.included_beds === 1 ? '' : 's'} included`;
  if (plan.max_extra_beds == null) {
    return `${included}, unlimited extra beds (${formatPaise(plan.extra_bed_price_paise ?? 0)}/bed)`;
  }
  if (plan.max_extra_beds === 0) return included;
  return `${included}, up to ${plan.max_extra_beds} extra (${formatPaise(plan.extra_bed_price_paise ?? 0)}/bed)`;
}

export function buildPlanCards(
  plans: PlanSummary[],
  sub: Pick<OwnerSubscription, 'status' | 'plan' | 'pending_plan'>,
): PlanCardView[] {
  const currentPlanId = sub.plan?.id ?? null;
  const currentPrice = sub.plan?.price_paise ?? null;
  const pendingId = sub.pending_plan?.id ?? null;
  return plans.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    priceLabel: formatMonthlyPrice(p.price_paise, p.code),
    capacityLabel: capacityLabel(p),
    isCurrent: sub.status === 'ACTIVE' && p.id === currentPlanId,
    isPending: p.id === pendingId,
    relation: planRelation(sub.status, currentPlanId, currentPrice, p),
  }));
}

// ── extra beds (business rules, 2026-09-10) ─────────────────────────────────
/**
 * Whether the owner can buy more extra beds on their CURRENT plan right now
 * — display-only; the backend is the source of truth and validates again on
 * submit. `null` `max_extra_beds` (FOUNDING) is always true; `0` (a plan that
 * doesn't offer extra beds, e.g. Portfolio today) is always false.
 */
export function canBuyMoreExtraBeds(
  plan: Pick<PlanSummary, 'max_extra_beds'> | null | undefined,
  currentExtraBeds: number,
): boolean {
  if (!plan) return false;
  if (plan.max_extra_beds == null) return true;
  return currentExtraBeds < plan.max_extra_beds;
}

/** How many more extra beds the owner could still add — null = unlimited (FOUNDING). */
export function remainingExtraBedAllowance(
  plan: Pick<PlanSummary, 'max_extra_beds'> | null | undefined,
  currentExtraBeds: number,
): number | null {
  if (!plan || plan.max_extra_beds == null) return null;
  return Math.max(0, plan.max_extra_beds - currentExtraBeds);
}

// ── downgrade / upgrade messaging ─────────────────────────────────────────
export function downgradeNotice(targetPlanName: string, periodEnd: string | null): string {
  const when = periodEnd ? `on ${formatDate(periodEnd)}` : 'at your next renewal';
  return `Your current plan stays active until the current period ends. The switch to ${targetPlanName} takes effect ${when} — you are not charged twice, and your current capacity does not change before then.`;
}

export function pendingDowngradeNotice(
  pendingPlanName: string,
  periodEnd: string | null,
): string {
  const when = periodEnd ? formatDate(periodEnd) : 'your next renewal';
  return `A downgrade to ${pendingPlanName} is scheduled — it applies from ${when}. Until then your current plan and its capacity are unchanged.`;
}

// ── payments ──────────────────────────────────────────────────────────────
const OPEN_PAYMENT_STATUSES: PaymentStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];

export function hasOpenPayment(payments: Pick<SubscriptionPayment, 'status'>[]): boolean {
  return payments.some((p) => OPEN_PAYMENT_STATUSES.includes(p.status));
}

export function openPayment(payments: SubscriptionPayment[]): SubscriptionPayment | null {
  return payments.find((p) => OPEN_PAYMENT_STATUSES.includes(p.status)) ?? null;
}

export function paymentStatusView(status: PaymentStatus): { label: string; tone: Tone } {
  switch (status) {
    case 'APPROVED':
      return { label: 'Approved', tone: 'positive' };
    case 'REJECTED':
      return { label: 'Rejected', tone: 'critical' };
    case 'UNDER_REVIEW':
      return { label: 'Under review', tone: 'info' };
    case 'SUBMITTED':
    default:
      return { label: 'Submitted', tone: 'warning' };
  }
}

// ── payment form validation (mirrors backend validatePaymentSubmission) ────
export interface PaymentFormDraft {
  method: PaymentMethod | '';
  amountPaise: number | null;
  transactionReference: string;
  proofFileUrl: string | null;
}

export function validatePaymentForm(draft: PaymentFormDraft): { ok: true } | { ok: false; reason: string } {
  if (draft.method !== 'UPI_MANUAL' && draft.method !== 'CASH') {
    return { ok: false, reason: 'Choose a payment method.' };
  }
  if (draft.amountPaise == null || !Number.isInteger(draft.amountPaise) || draft.amountPaise <= 0) {
    return { ok: false, reason: 'A valid amount is required.' };
  }
  if (draft.method === 'UPI_MANUAL') {
    if (!draft.transactionReference.trim()) {
      return { ok: false, reason: 'Enter the UPI reference / UTR number from your payment.' };
    }
    if (!draft.proofFileUrl) {
      return { ok: false, reason: 'Attach a screenshot of your payment.' };
    }
  }
  return { ok: true };
}

// ── backend error → friendly message ──────────────────────────────────────
const ERROR_MESSAGES: Record<string, string> = {
  SUBSCRIPTION_INACTIVE:
    'Your subscription is not active yet. Complete your payment to continue.',
  SUBSCRIPTION_CAPACITY_REACHED:
    "You've reached your plan's active-tenant limit. Upgrade your plan to add more.",
  FOUNDING_FULL:
    'The Founding plan is limited to the first 10 owners and is now full. Please choose another plan.',
  PAYMENT_ALREADY_PENDING:
    'You already have a payment awaiting review. Wait for it to be reviewed before submitting another.',
  INVALID_PAYMENT: 'Please check the payment details and try again.',
  PLAN_NOT_FOUND: 'That plan is no longer available. Please pick another.',
  PLAN_NOT_CONFIGURED: 'Plans are not set up yet. Please contact Stayo.',
  NOT_AN_UPGRADE: 'That plan is not an upgrade — a downgrade takes effect at your next renewal.',
  NOT_ACTIVE: 'This action is only available on an active subscription.',
  REASON_REQUIRED: 'A reason is required.',
  VALIDATION_ERROR: 'Please check the details and try again.',
};

export function mapBackendError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const anyErr = err as any;
  const code = String(anyErr?.response?.data?.error?.code ?? anyErr?.code ?? '').toUpperCase();
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  const message = anyErr?.response?.data?.error?.message;
  if (typeof message === 'string' && message.trim() && !/stack|prisma|ECONNREFUSED|at .*\(/i.test(message)) {
    return message;
  }
  return fallback;
}

// ── invoices ──────────────────────────────────────────────────────────────
export interface InvoiceRowView {
  id: string;
  invoiceNumber: string;
  planLabel: string;
  amountLabel: string;
  periodLabel: string;
  issuedLabel: string;
  methodLabel: string;
  /** e.g. "10 extra beds @ ₹10/bed" — null when the invoice has no extra beds (business rules, 2026-09-10). */
  extraBedsLabel: string | null;
  /** Plan-only portion of the total (Phase 6.6). */
  planAmountLabel: string;
  /** What was actually charged for extra beds on THIS invoice — null when there's no extra-bed charge. */
  extraBedAmountLabel: string | null;
  /** 'ready' → downloadable now; 'pending' → row exists, PDF still being made. */
  documentState: 'ready' | 'pending';
  downloadFilename: string;
}

/** Shape one `subscription_invoices` row for the Invoices list. No business math. */
export function invoiceRowView(inv: SubscriptionInvoice): InvoiceRowView {
  return {
    id: inv.id,
    invoiceNumber: inv.invoice_number,
    planLabel: inv.plan_name?.trim() || 'Stayo subscription',
    amountLabel: formatPaise(inv.amount_paise),
    periodLabel: formatPeriod(inv.billing_period_start, inv.billing_period_end),
    issuedLabel: formatDate(inv.issued_at),
    methodLabel: paymentMethodLabel(inv.payment_method),
    extraBedsLabel:
      inv.extra_beds > 0
        ? `${inv.extra_beds} extra bed${inv.extra_beds === 1 ? '' : 's'}${
            inv.extra_bed_unit_price_paise != null ? ` @ ${formatPaise(inv.extra_bed_unit_price_paise)}/bed` : ''
          }`
        : null,
    planAmountLabel: formatPaise(inv.plan_amount_paise),
    extraBedAmountLabel: inv.extra_bed_amount_paise > 0 ? formatPaise(inv.extra_bed_amount_paise) : null,
    documentState: inv.document_ready ? 'ready' : 'pending',
    downloadFilename: `${(inv.invoice_number || 'invoice').replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`,
  };
}

// ── payment method labels ─────────────────────────────────────────────────
export function paymentMethodLabel(method: string): string {
  switch (method) {
    case 'UPI_MANUAL':
      return 'UPI (manual)';
    case 'CASH':
      return 'Cash';
    case 'BANK_TRANSFER':
      return 'Bank transfer';
    case 'GATEWAY':
      return 'Online payment';
    default:
      return method;
  }
}
