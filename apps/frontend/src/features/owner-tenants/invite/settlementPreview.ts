/**
 * "Has the tenant already paid anything?" — pure decision/display logic for
 * the Invite wizard's Money and Verify steps.
 *
 * Two real situations feed this: a deposit negotiated face-to-face and paid
 * in cash or over UPI at the door, and a hostel adopting a tenant who is
 * already months into their stay and has paid for them. Both are answered by
 * the same backend call — `POST /tenants/invite-settlement-preview` — which
 * runs the real settlement planner against obligations synthesised from the
 * form, before anything is created. This module decides *when* to call it,
 * *what* to send, and how to turn what comes back into the concrete lines the
 * Verify step shows ("Deposit ₹16,000 · Aug rent ₹8,000 · Sep ₹8,000 ·
 * Oct ₹8,000 / ₹24,000 still due, Nov onwards") — it never recomputes the
 * allocation itself.
 */

import type { InviteWizardData } from '../types';

export interface InviteSettlementPreviewRequestBody {
  hostel_id: string;
  monthly_rent: number;
  security_deposit: number;
  maintenance_charge: number;
  agreement_start_date: string;
  agreement_duration_months: number;
  amount_paid: number;
  amount_includes_deposit: boolean;
}

export interface SettlementAllocationLite {
  obligation_id: string;
  type: string;
  rent_month: string | null;
  amount_due: number;
  outstanding: number;
  allocated: number;
  result: 'PAID' | 'PARTIAL' | 'UNCHANGED';
}

/** Where the rent money went — computed by the backend's `summarizeRentCoverage`, never here. */
export interface RentCoverageLite {
  months_covered: number;
  paid_through_month: string | null;
  partial: { rent_month: string; allocated: number; remaining: number } | null;
  next_due_month: string | null;
  rent_allocated: number;
  future_rent_covered: number;
  current_due: number;
}

export interface InviteSettlementPreviewResponse {
  allocations: SettlementAllocationLite[];
  unallocated: number;
  total_outstanding: number;
  total_to_settle: number;
  remaining_outstanding: number;
  payment_accepted: boolean;
  rejection_reason: string | null;
  rent_months: string[];
  /**
   * Paying ahead (ADR-236). Optional so an older backend that predates it
   * still renders: without them the panel falls back to the per-line view.
   */
  advance_rent_months?: string[];
  coverage?: RentCoverageLite;
  agreement?: { duration_months: number; last_month: string | null };
  max_recordable?: number;
  owed_today?: number;
}

/**
 * Has the owner told us enough to make a preview call worth making? Money
 * hasn't necessarily been entered yet — the toggle can be on with a blank
 * amount while they're still typing — so this gates on the fields that
 * would make the request meaningless or invalid, not on form-completeness.
 */
export function isPreviewRequestReady(data: InviteWizardData): boolean {
  return previewBlockers(data).length === 0;
}

/**
 * What is still missing before a settlement can be worked out — in the owner's
 * words, ready to put on screen.
 *
 * The readiness check used to be a silent boolean, and the screen rendered
 * `null` when it said no. So an owner who switched "already paid" on and typed
 * an amount got a headed box with nothing inside it: no figure, no spinner, no
 * reason. That became far more common once the invite form stopped shipping
 * hardcoded defaults, because agreement length now starts genuinely empty.
 *
 * Returning the reasons rather than a boolean is what lets the screen say
 * "add the monthly rent to work this out" instead of showing an empty panel
 * and leaving the owner to guess which field it wants.
 */
export function previewBlockers(data: InviteWizardData): string[] {
  if (!data.hasPaidAlready) return ['not applicable'];

  const missing: string[] = [];
  if (!data.hostelId) missing.push('a hostel');
  if (!data.joiningDate || Number.isNaN(new Date(data.joiningDate).getTime())) missing.push('a joining date');
  // Rent is what everything else is settled against. Previously this fell back
  // to 0, which produced a confident, wrong answer: every rupee read as
  // advance credit because nothing was ever owed.
  if (!(Number(data.monthlyRent) > 0)) missing.push('the monthly rent');
  if (!(Number(data.agreementMonths) > 0)) missing.push('how long the agreement runs');
  if (!(Number(data.paidAmount) > 0)) missing.push('how much they have paid');
  return missing;
}

/**
 * The sentence shown in place of the settlement while it cannot be worked out.
 * `null` once nothing is missing.
 */
export function describePreviewBlockers(data: InviteWizardData): string | null {
  const missing = previewBlockers(data).filter((m) => m !== 'not applicable');
  if (missing.length === 0) return null;

  const list =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  return `Add ${list} to see how this payment settles.`;
}

/** Builds the exact request body for `POST /tenants/invite-settlement-preview`, or null if not ready yet — see `isPreviewRequestReady`. */
export function buildPreviewRequestBody(data: InviteWizardData): InviteSettlementPreviewRequestBody | null {
  if (!isPreviewRequestReady(data)) return null;
  return {
    hostel_id: data.hostelId,
    monthly_rent: Number(data.monthlyRent) || 0,
    security_deposit: Number(data.deposit) || 0,
    maintenance_charge: Number(data.maintenance) || 0,
    agreement_start_date: data.joiningDate,
    agreement_duration_months: Number(data.agreementMonths),
    amount_paid: Number(data.paidAmount) || 0,
    amount_includes_deposit: data.paidIncludesDeposit,
  };
}

/**
 * A stable, order-independent key for React Query — the request body's own
 * field values are the only thing that should trigger a refetch.
 */
export function previewRequestKey(body: InviteSettlementPreviewRequestBody): string {
  return JSON.stringify(body);
}

/**
 * What is wrong with the "Paid on" date, in the owner's words — or null.
 * Blank is fine (it means today). A date in the future is refused, matching
 * the server: money not yet received cannot be recorded as received.
 */
export function paidOnError(data: InviteWizardData, today: Date = new Date()): string | null {
  const value = data.paidOn?.trim();
  if (!value) return null;
  const paid = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(paid.getTime())) return 'Enter a valid date.';
  const todayIso = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())).toISOString().slice(0, 10);
  if (value > todayIso) return 'The payment date cannot be in the future.';
  return null;
}

/** Whether Money-step's payment fields are complete enough to advance — payment method is only required once an amount is actually recorded, mirroring the backend's own rule. */
export function isPaymentDetailsValid(data: InviteWizardData, today: Date = new Date()): boolean {
  if (!data.hasPaidAlready) return true;
  const paidAmount = Number(data.paidAmount) || 0;
  if (paidAmount <= 0) return true;
  return Boolean(data.paymentMethod) && paidOnError(data, today) === null;
}

export interface PreviewDisplayLine {
  key: string;
  label: string;
  amount: number;
}

export interface PreviewCoverage {
  /** Rent months fully paid by this amount — arrears and advance together. */
  monthsCovered: number;
  /** "Jul 2027" — the last month of unbroken paid rent. Null when the first month is not fully paid. */
  paidThroughLabel: string | null;
  /** Of `monthsCovered`, how many are after the current month. */
  futureRentCovered: number;
  /** "₹8,000 toward Jun 2027 rent — ₹200 still to pay for that month" — null with no partly-paid month. */
  partialNote: string | null;
  /** "Aug 2027" — when rent next falls due once this payment lands. */
  nextDueLabel: string | null;
}

export interface PreviewDisplay {
  /** "₹40,000 received" */
  headline: string;
  /**
   * "Deposit ₹16,000", then rent. Fully paid consecutive months collapse to one
   * line ("Rent, Aug 2026 – Jul 2027 · 12 months") so a year paid up front is
   * one line, not twelve; a partly-paid month gets its own line.
   */
  lines: PreviewDisplayLine[];
  /** "Nov 2026 onwards" — null when there's no rent track or nothing left owing. */
  outstandingLabel: string | null;
  /**
   * What is still owed **today** once this payment lands, in rupees. `0` means
   * nothing is due now. The unpaid part of a future, partly-prepaid month is
   * not "due" — it is reported in `coverage.partialNote` instead.
   */
  remainingOutstanding: number;
  /** Rent coverage, when the backend reports it. */
  coverage: PreviewCoverage | null;
  /**
   * > 0 when the amount runs past the agreement's last rent month. StayO holds
   * no credit balance (ADR-036), so the invite refuses this — the panel says so
   * with the figure that can be recorded instead.
   */
  overpaidAmount: number;
  /** The most this invite can record, when `overpaidAmount > 0`. */
  maxRecordable: number | null;
  /** Plain-language warning for the excess case, or the backend's own rejection reason — null when the preview is clean. */
  warning: string | null;
}

// Fixed table rather than `toLocaleDateString(..., { month: 'short' })` —
// ICU's en-IN short month for September renders "Sept" (4 letters) while
// every other month renders 3, which reads as inconsistent in a compact
// "Aug rent · Sep · Oct" line.
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthShortLabel(iso: string): string {
  return MONTH_SHORT[new Date(iso).getUTCMonth()];
}

/** "Jul 2027" — a month a year or more away needs its year to mean anything. */
export function monthYearLabel(iso: string): string {
  const d = new Date(iso);
  return `${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function monthAfter(iso: string): string {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

function monthIndex(iso: string): number {
  const d = new Date(iso);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

const rupees = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;

const TYPE_LABELS: Record<string, string> = {
  SECURITY_DEPOSIT: 'Deposit',
  MAINTENANCE: 'Maintenance',
};

/**
 * Rent lines. Up to three months keep the familiar "Aug rent · Sep · Oct"
 * shape; beyond that, each run of consecutive fully-paid months collapses to
 * one ranged line, because twelve near-identical rows bury the deposit line
 * the owner is also checking.
 */
function rentLines(rentAllocs: SettlementAllocationLite[]): PreviewDisplayLine[] {
  const paidAllocs = rentAllocs.filter((a) => a.allocated > 0);
  const spansYears =
    paidAllocs.length > 0 &&
    new Date(paidAllocs[0].rent_month as string).getUTCFullYear() !==
      new Date(paidAllocs[paidAllocs.length - 1].rent_month as string).getUTCFullYear();

  if (paidAllocs.length <= 3 && !spansYears) {
    return paidAllocs.map((alloc, i) => {
      const month = alloc.rent_month ? monthShortLabel(alloc.rent_month) : 'Rent';
      const part = alloc.result === 'PARTIAL' ? ' (part)' : '';
      return { key: alloc.obligation_id, label: `${i === 0 ? `${month} rent` : month}${part}`, amount: alloc.allocated };
    });
  }

  const lines: PreviewDisplayLine[] = [];
  let run: SettlementAllocationLite[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const first = run[0].rent_month as string;
    const last = run[run.length - 1].rent_month as string;
    const amount = run.reduce((sum, a) => sum + Math.round(a.allocated * 100), 0) / 100;
    lines.push({
      key: run[0].obligation_id,
      label:
        run.length === 1
          ? `${monthYearLabel(first)} rent`
          : `Rent, ${monthYearLabel(first)} – ${monthYearLabel(last)} · ${run.length} months`,
      amount,
    });
    run = [];
  };
  for (const alloc of paidAllocs) {
    const prev = run[run.length - 1];
    const contiguous = prev && monthIndex(alloc.rent_month as string) === monthIndex(prev.rent_month as string) + 1;
    if (alloc.result === 'PAID' && (!prev || contiguous)) {
      run.push(alloc);
      continue;
    }
    flush();
    if (alloc.result === 'PAID') {
      run.push(alloc);
    } else {
      lines.push({
        key: alloc.obligation_id,
        label: `${monthYearLabel(alloc.rent_month as string)} rent (part)`,
        amount: alloc.allocated,
      });
    }
  }
  flush();
  return lines;
}

function describeCoverage(coverage: RentCoverageLite): PreviewCoverage {
  const futureMonths = Math.round(coverage.future_rent_covered * 100) > 0;
  return {
    monthsCovered: coverage.months_covered,
    paidThroughLabel: coverage.paid_through_month ? monthYearLabel(coverage.paid_through_month) : null,
    futureRentCovered: futureMonths ? coverage.future_rent_covered : 0,
    partialNote: coverage.partial
      ? `${rupees(coverage.partial.allocated)} toward ${monthYearLabel(coverage.partial.rent_month)} rent — ${rupees(coverage.partial.remaining)} still to pay for that month`
      : null,
    nextDueLabel: coverage.next_due_month ? monthYearLabel(coverage.next_due_month) : null,
  };
}

/**
 * Turns an `InviteSettlementPreviewResponse` into the concrete lines the
 * Verify step renders. `monthlyRent` decides whether an "onwards
 * outstanding" line makes sense at all — a hostel with no rent has no
 * ongoing accrual to point at.
 */
export function buildPreviewDisplay(
  preview: InviteSettlementPreviewResponse,
  params: { paidAmount: number; monthlyRent: number },
): PreviewDisplay {
  const { paidAmount, monthlyRent } = params;

  const lines: PreviewDisplayLine[] = [];
  for (const alloc of preview.allocations) {
    if (alloc.allocated <= 0 || alloc.type === 'RENT') continue;
    lines.push({ key: alloc.obligation_id, label: TYPE_LABELS[alloc.type] || alloc.type, amount: alloc.allocated });
  }
  const rentAllocs = preview.allocations
    .filter((a) => a.type === 'RENT' && a.rent_month)
    .sort((a, b) => new Date(a.rent_month as string).getTime() - new Date(b.rent_month as string).getTime());
  lines.push(...rentLines(rentAllocs));

  let outstandingLabel: string | null = null;
  if (monthlyRent > 0) {
    const firstUnpaidRent = rentAllocs.find((a) => a.result !== 'PAID');
    const startIso = firstUnpaidRent?.rent_month
      ? firstUnpaidRent.rent_month
      : preview.rent_months.length > 0
        ? monthAfter(preview.rent_months[preview.rent_months.length - 1])
        : null;
    if (startIso) {
      outstandingLabel = `${monthShortLabel(startIso)} onwards`;
    }
  }

  const overpaidAmount = Math.max(preview.unallocated, 0);
  const maxRecordable = overpaidAmount > 0 ? (preview.max_recordable ?? preview.total_to_settle) : null;
  let warning: string | null = null;
  if (overpaidAmount > 0) {
    const months = preview.agreement?.duration_months;
    const through = preview.agreement?.last_month ? ` (through ${monthYearLabel(preview.agreement.last_month)})` : '';
    warning =
      `${rupees(overpaidAmount)} remains after covering ${months ? `the whole ${months}-month agreement` : 'everything this tenancy can bill'}${through}. ` +
      `Stayo doesn't hold extra money as credit, so record ${rupees(maxRecordable ?? 0)} or less, or lengthen the agreement.`;
  } else if (!preview.payment_accepted && preview.rejection_reason) {
    warning = preview.rejection_reason;
  }

  return {
    headline: `${rupees(paidAmount)} received`,
    lines,
    outstandingLabel,
    remainingOutstanding: Math.max(preview.coverage?.current_due ?? preview.remaining_outstanding, 0),
    coverage: preview.coverage && monthlyRent > 0 ? describeCoverage(preview.coverage) : null,
    overpaidAmount,
    maxRecordable,
    warning,
  };
}

/**
 * True when the preview says this amount cannot be recorded — it runs past the
 * agreement. Send is held back on it, so the refusal is read on this screen
 * rather than arriving from the server after the owner pressed Send.
 */
export function isPaidAmountRecordable(preview: InviteSettlementPreviewResponse | undefined | null): boolean {
  return !preview || !(preview.unallocated > 0.005);
}
