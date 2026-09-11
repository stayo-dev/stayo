/**
 * Pure view logic for the admin subscription/revenue screens (ADR-172, Phase 5).
 *
 * Backend owns every business value (price, MRR, capacity, FOUNDING eligibility,
 * proration). This module only shapes returned data into labels/tones and maps
 * error codes to admin-facing messages. Node-env test convention.
 */
export type AdminSubStatus = 'PENDING_PAYMENT' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'CANCELLED' | 'TRIAL';
export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'info';

export function formatPaise(paise: number | null | undefined): string {
  if (paise == null || Number.isNaN(paise)) return '—';
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function subStatusView(status: string): { label: string; tone: Tone } {
  switch (status) {
    case 'ACTIVE':
      return { label: 'Active', tone: 'ok' };
    case 'PENDING_PAYMENT':
      return { label: 'Payment pending', tone: 'warn' };
    case 'PAUSED':
      return { label: 'Paused', tone: 'bad' };
    case 'EXPIRED':
      return { label: 'Expired', tone: 'bad' };
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'muted' };
    case 'TRIAL':
      // Stayo has no trial — a legacy row is shown as awaiting first payment,
      // never as a live trial state.
      return { label: 'Awaiting payment', tone: 'warn' };
    default:
      return { label: status, tone: 'muted' };
  }
}

export function paymentStatusView(status: string): { label: string; tone: Tone } {
  switch (status) {
    case 'APPROVED':
      return { label: 'Approved', tone: 'ok' };
    case 'REJECTED':
      return { label: 'Rejected', tone: 'bad' };
    case 'UNDER_REVIEW':
      return { label: 'Under review', tone: 'info' };
    case 'SUBMITTED':
      return { label: 'Submitted', tone: 'warn' };
    default:
      return { label: status, tone: 'muted' };
  }
}

/** Plan label: "Founding — ₹2,000/month — Unlimited" / "Growth — ₹2,499/month — 51–100". */
export function planLabel(
  plan: {
    code?: string;
    name?: string;
    price_paise?: number | null;
    capacity_max?: number | null;
    capacity_min?: number | null;
    included_beds?: number | null;
    max_extra_beds?: number | null;
    extra_bed_price_paise?: number | null;
  } | null,
): string {
  if (!plan) return '—';
  const price = plan.price_paise != null ? `${formatPaise(plan.price_paise)}/month` : null;
  // Business rules (2026-09-10): included vs. paid-extra beds, when the plan
  // carries that data — falls back to the legacy min–max range otherwise.
  let cap: string;
  if (plan.included_beds != null) {
    if (plan.max_extra_beds == null) cap = `${plan.included_beds} included, unlimited extra`;
    else if (plan.max_extra_beds === 0) cap = `${plan.included_beds} included`;
    else cap = `${plan.included_beds} included, +${plan.max_extra_beds} extra`;
  } else {
    cap = plan.capacity_max == null ? 'Unlimited' : `${plan.capacity_min ?? 1}–${plan.capacity_max}`;
  }
  return [plan.name ?? plan.code ?? '—', price, cap].filter(Boolean).join(' — ');
}

/** Admin filter chips for the subscription list (business rules, 2026-09-10). */
export const PLAN_FILTER_CHIPS = [
  { key: 'ALL', label: 'All plans' },
  { key: 'FOUNDING', label: 'Founding' },
  { key: 'STARTER', label: 'Starter' },
  { key: 'GROWTH', label: 'Growth' },
  { key: 'PROFESSIONAL', label: 'Professional' },
  { key: 'PORTFOLIO', label: 'Portfolio' },
] as const;

/** Capacity cell: "73 / 100" or "Unlimited". `null` capacity_max = FOUNDING/custom. */
export function capacityText(usage: { used?: number; capacity_max?: number | null } | null | undefined): string {
  if (!usage) return '—';
  if (usage.capacity_max == null) return 'Unlimited';
  return `${usage.used ?? 0} / ${usage.capacity_max}`;
}

export function isReviewablePayment(status: string): boolean {
  return status === 'SUBMITTED' || status === 'UNDER_REVIEW';
}

/** Can this subscription action be offered for the given status? Backend still validates. */
export function availableActions(status: string): Array<'pause' | 'resume' | 'extend' | 'change-plan' | 'cash'> {
  switch (status) {
    case 'ACTIVE':
      return ['pause', 'extend', 'change-plan', 'cash'];
    case 'PENDING_PAYMENT':
      return ['pause', 'extend', 'change-plan', 'cash'];
    case 'PAUSED':
    case 'EXPIRED':
      return ['resume', 'extend', 'change-plan', 'cash'];
    case 'CANCELLED':
      return ['change-plan', 'cash'];
    case 'TRIAL':
      return ['pause', 'extend', 'change-plan', 'cash'];
    default:
      return [];
  }
}

export function overrideActive(admin_override_until: string | null | undefined, now: Date = new Date()): boolean {
  if (!admin_override_until) return false;
  const d = new Date(admin_override_until);
  return !Number.isNaN(d.getTime()) && d.getTime() >= now.getTime();
}

// ── MRR / revenue ─────────────────────────────────────────────────────────
export interface RevenueTiles {
  mrr: string;
  arr: string;
  collectedThisMonth: string;
  lifetime: string;
  activeSubs: number;
  pendingReview: number;
}

export function revenueTiles(data: {
  kpis: Record<string, number>;
  subscriptions: Record<string, number>;
  payments: Record<string, number>;
}): RevenueTiles {
  return {
    mrr: formatPaise(data.kpis?.mrr_paise),
    arr: formatPaise(data.kpis?.arr_paise),
    collectedThisMonth: formatPaise(data.kpis?.collected_this_month_paise),
    lifetime: formatPaise(data.kpis?.lifetime_paise),
    activeSubs: data.subscriptions?.active ?? 0,
    pendingReview: data.payments?.pending_review ?? 0,
  };
}

// ── error mapping ─────────────────────────────────────────────────────────
const ERR: Record<string, string> = {
  FOUNDING_FULL: 'The Founding plan is limited to the first 10 owners and is full — assign a different plan.',
  SUBSCRIPTION_INACTIVE: 'This subscription is not active.',
  SUBSCRIPTION_CAPACITY_REACHED:
    "The owner's active-tenant count exceeds this plan's limit. Schedule the change for the next renewal instead.",
  PAYMENT_ALREADY_PENDING: 'This owner already has a payment awaiting review — approve or reject it first.',
  INVALID_PAYMENT: 'Check the payment details and try again.',
  PLAN_NOT_FOUND: 'That plan does not exist or is inactive.',
  NOT_REVIEWABLE: 'This payment has already been reviewed.',
  INVALID_TRANSITION: 'That action is not allowed for this subscription right now.',
  REASON_REQUIRED: 'A reason is required.',
  OVERRIDE_TOO_LONG: 'An override can extend access by at most 30 days per action.',
  OVERRIDE_INVALID: 'Enter a valid future date within 30 days.',
  NOT_A_DOWNGRADE: 'That plan is not a downgrade.',
  NO_PENDING_CHANGE: 'There is no scheduled plan change to cancel.',
  FORBIDDEN: 'You do not have permission to do that.',
  VALIDATION_ERROR: 'Please check the details and try again.',
};

export function adminError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const anyErr = err as any;
  const code = String(anyErr?.response?.data?.error?.code ?? anyErr?.code ?? '').toUpperCase();
  if (code && ERR[code]) return ERR[code];
  const message = anyErr?.response?.data?.error?.message;
  if (typeof message === 'string' && message.trim() && !/stack|prisma|ECONNREFUSED|at .*\(/i.test(message)) {
    return message;
  }
  return fallback;
}

export function paymentMethodLabel(method: string): string {
  if (method === 'UPI_MANUAL') return 'UPI (manual)';
  if (method === 'CASH') return 'Cash';
  if (method === 'BANK_TRANSFER') return 'Bank transfer';
  return method;
}
