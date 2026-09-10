/**
 * Grouping + ordering for the owner tenant profile's payment schedule.
 *
 * Fed from the backend `billingTimelineService` (`GET /api/tenants/:id/
 * billing-timeline`) — the same read model the tenant portal uses — so the
 * owner and tenant see the identical set of obligations/payments. This module
 * is pure so it can be unit-tested directly (see `paymentSchedule.test.ts`);
 * the component is a thin renderer over `groupPaymentSchedule`.
 */

export type PaymentScheduleState =
  | 'paid'
  | 'partial'
  | 'overdue'
  | 'due_soon'
  | 'upcoming'
  | 'pending'
  | 'waived';

export interface PaymentScheduleItem {
  id: string;
  /** RENT / MAINTENANCE / SECURITY_DEPOSIT / LATE_FEE / … */
  type: string;
  label: string;
  amount: number;
  paid: number;
  outstanding: number;
  /** ISO date string. */
  dueDate: string | null;
  /** ISO date string of the latest payment, when settled/partly settled. */
  paidDate: string | null;
  /** Human label for the billing period, e.g. "Sep 2026". */
  billingPeriodLabel: string | null;
  method: string | null;
  referenceNumber: string | null;
  state: PaymentScheduleState;
}

export interface NextScheduledPayment {
  amount: number;
  dueDate: string | null;
  /** True when this is a projection (no obligation row exists yet). */
  projected: boolean;
  billingPeriodLabel: string | null;
}

export interface PaymentSchedule {
  overdue: PaymentScheduleItem[];
  upcoming: PaymentScheduleItem[];
  paid: PaymentScheduleItem[];
  next: NextScheduledPayment | null;
}

const SETTLED_STATES: PaymentScheduleState[] = ['paid', 'waived'];

/** UTC-midnight day key, matching the backend's date maths. */
function dayKey(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  const t = d.getTime();
  if (Number.isNaN(t)) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function monthLabel(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * "Sep 2026" for a one-month installment, "Oct–Dec 2026" for a multi-month one
 * (quarterly / half-yearly / yearly). Makes a ₹22,500 quarterly figure read as
 * what it is instead of a mystery 3× the monthly rent.
 */
function periodRangeLabel(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
): string | null {
  const s = start ? new Date(String(start)) : null;
  const e = end ? new Date(String(end)) : null;
  if (!s || Number.isNaN(s.getTime())) return monthLabel(end);
  if (!e || Number.isNaN(e.getTime())) return monthLabel(start);
  const sameMonth = s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth();
  if (sameMonth) return monthLabel(s);
  const sM = s.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });
  const eM = e.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${sM}–${eM}`;
}

/**
 * Normalises one raw `billingTimelineService` timeline event into a
 * `PaymentScheduleItem`. Events that are pure payment records (no obligation)
 * are dropped — they're represented by the obligation row they settled.
 */
export function toScheduleItem(raw: Record<string, any>): PaymentScheduleItem | null {
  const obligationId = raw.obligation_id ?? raw.id;
  if (!obligationId) return null;
  if (raw.obligation_type === 'PAYMENT' || raw.obligation_type === 'RENT_CREDIT') return null;

  const amount = Number(raw.amount ?? raw.original_amount ?? 0);
  const paid = Number(raw.paid ?? raw.paid_amount ?? 0);
  const outstanding = Number(raw.remaining ?? raw.remaining_amount ?? Math.max(amount - paid, 0));
  const rawState = String(raw.state ?? '').toLowerCase();
  const state: PaymentScheduleState = ([
    'paid', 'partial', 'overdue', 'due_soon', 'upcoming', 'pending', 'waived',
  ] as PaymentScheduleState[]).includes(rawState as PaymentScheduleState)
    ? (rawState as PaymentScheduleState)
    : 'pending';

  return {
    id: String(obligationId),
    type: String(raw.obligation_type ?? 'RENT'),
    label: String(raw.label ?? raw.installment_label ?? 'Rent'),
    amount,
    paid,
    outstanding,
    dueDate: raw.due_date ? String(raw.due_date) : null,
    paidDate: raw.paid_date && state !== 'upcoming' && state !== 'pending' ? String(raw.paid_date) : null,
    billingPeriodLabel:
      periodRangeLabel(raw.period_start ?? raw.rent_month, raw.period_end)
      ?? monthLabel(raw.period_start ?? raw.rent_month),
    method: raw.payment_method ? String(raw.payment_method) : null,
    referenceNumber: raw.reference_number ? String(raw.reference_number) : null,
    state,
  };
}

/**
 * Splits the timeline into Overdue / Upcoming / Paid sections and computes the
 * single "next payment". `today` is injected so the result is stable within a
 * render and testable.
 */
export function groupPaymentSchedule(
  rawItems: Array<Record<string, any>> | undefined | null,
  nextRentGeneration: Record<string, any> | undefined | null,
  today: string | Date = new Date(),
): PaymentSchedule {
  const todayKey = dayKey(today) ?? 0;
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .map(toScheduleItem)
    .filter((i): i is PaymentScheduleItem => i !== null);

  const overdue: PaymentScheduleItem[] = [];
  const upcoming: PaymentScheduleItem[] = [];
  const paid: PaymentScheduleItem[] = [];

  for (const item of items) {
    if (SETTLED_STATES.includes(item.state)) {
      paid.push(item);
      continue;
    }
    const due = dayKey(item.dueDate);
    const isPastDue = due !== null && due < todayKey;
    if (item.state === 'overdue' || (isPastDue && item.outstanding > 0)) {
      overdue.push(item);
    } else {
      upcoming.push(item);
    }
  }

  const byDueAsc = (a: PaymentScheduleItem, b: PaymentScheduleItem) =>
    (dayKey(a.dueDate) ?? Infinity) - (dayKey(b.dueDate) ?? Infinity);
  const byDueDesc = (a: PaymentScheduleItem, b: PaymentScheduleItem) =>
    (dayKey(b.paidDate ?? b.dueDate) ?? -Infinity) - (dayKey(a.paidDate ?? a.dueDate) ?? -Infinity);

  overdue.sort(byDueAsc);
  upcoming.sort(byDueAsc);
  paid.sort(byDueDesc);

  // "Next payment" — the earliest still-owed obligation. Falls back to the
  // backend's projected next installment when no unsettled row exists yet
  // (e.g. the monthly generator hasn't run for this period).
  const earliestOwed = [...overdue, ...upcoming][0] ?? null;
  let next: NextScheduledPayment | null = null;
  if (earliestOwed) {
    next = {
      amount: earliestOwed.outstanding || earliestOwed.amount,
      dueDate: earliestOwed.dueDate,
      projected: false,
      billingPeriodLabel: earliestOwed.billingPeriodLabel,
    };
  } else if (nextRentGeneration && Number(nextRentGeneration.next_installment_amount) > 0) {
    next = {
      amount: Number(nextRentGeneration.next_installment_amount),
      dueDate: nextRentGeneration.next_installment_due_date
        ? String(nextRentGeneration.next_installment_due_date)
        : null,
      projected: true,
      billingPeriodLabel:
        periodRangeLabel(nextRentGeneration.period_start, nextRentGeneration.period_end)
        ?? monthLabel(nextRentGeneration.period_start ?? nextRentGeneration.next_rent_month),
    };
  }

  return { overdue, upcoming, paid, next };
}

export interface NextPaymentLabel {
  /** e.g. "₹7,500" — null when nothing is due or projected. */
  amount: string | null;
  /** e.g. "05 Sep 2026" */
  dateLabel: string | null;
  /** e.g. "in 3 days" / "Due today" / "2 days late" / "Nothing due" */
  timing: string;
  /** The billing period this covers — e.g. "Sep 2026" or "Oct–Dec 2026" for a
   *  multi-month (quarterly/yearly) installment. Shown so a 3× figure reads. */
  periodLabel: string | null;
  /** True when this installment spans more than one month. */
  multiMonth: boolean;
  isOverdue: boolean;
  projected: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Formats `PaymentSchedule.next` for the profile header. Replaces the old
 * `nextPaymentDue` heuristic which only saw the capped `/full` obligation list
 * and rendered "Nothing due" whenever it was empty.
 */
export function describeNextPayment(
  next: NextScheduledPayment | null,
  today: string | Date = new Date(),
): NextPaymentLabel {
  if (!next) {
    return { amount: null, dateLabel: null, timing: 'Nothing due', periodLabel: null, multiMonth: false, isOverdue: false, projected: false };
  }
  const periodLabel = next.billingPeriodLabel;
  const multiMonth = Boolean(periodLabel && periodLabel.includes('–'));
  const amount = Number.isFinite(next.amount) && next.amount > 0
    ? `₹${Math.round(next.amount).toLocaleString('en-IN')}`
    : null;
  const dueKey = dayKey(next.dueDate);
  const todayKey = dayKey(today);
  const dateLabel = next.dueDate
    ? new Date(next.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;

  let timing = next.projected ? 'Next cycle' : 'Upcoming';
  let isOverdue = false;
  if (dueKey !== null && todayKey !== null) {
    const days = Math.round((dueKey - todayKey) / MS_PER_DAY);
    const unit = Math.abs(days) === 1 ? 'day' : 'days';
    if (days === 0) timing = 'Due today';
    else if (days < 0) { timing = `${Math.abs(days)} ${unit} late`; isOverdue = true; }
    else timing = `in ${days} ${unit}`;
  }

  return { amount, dateLabel, timing, periodLabel, multiMonth, isOverdue, projected: next.projected };
}
