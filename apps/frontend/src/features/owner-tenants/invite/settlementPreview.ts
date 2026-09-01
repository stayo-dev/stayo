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

export interface InviteSettlementPreviewResponse {
  allocations: SettlementAllocationLite[];
  unallocated: number;
  total_outstanding: number;
  total_to_settle: number;
  remaining_outstanding: number;
  payment_accepted: boolean;
  rejection_reason: string | null;
  rent_months: string[];
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

/** Whether Money-step's payment fields are complete enough to advance — payment method is only required once an amount is actually recorded, mirroring the backend's own rule. */
export function isPaymentDetailsValid(data: InviteWizardData): boolean {
  if (!data.hasPaidAlready) return true;
  const paidAmount = Number(data.paidAmount) || 0;
  if (paidAmount <= 0) return true;
  return Boolean(data.paymentMethod);
}

export interface PreviewDisplayLine {
  key: string;
  label: string;
  amount: number;
}

export interface PreviewDisplay {
  /** "₹40,000 received" */
  headline: string;
  /** "Deposit ₹16,000", "Aug rent ₹8,000", "Sep ₹8,000", "Oct ₹8,000" */
  lines: PreviewDisplayLine[];
  /** "Nov onwards" — null when there's no rent track (no monthly rent) or nothing left owing beyond the plan's horizon. */
  outstandingLabel: string | null;
  /**
   * What is still owed once this payment lands, in rupees. `0` means fully
   * settled.
   *
   * A month name on its own ("Nov onwards outstanding") told an owner *when*
   * the tenant falls behind but never *how much*, which is the figure they are
   * checking against the cash in their hand before they commit to the invite.
   * Taken straight from the backend's own plan — never recomputed here.
   */
  remainingOutstanding: number;
  /** > 0 when the amount exceeds every settleable installment (ADR-036: an error, not a balance). */
  overpaidAmount: number;
  /** Plain-language warning for the overpaid case, or the backend's own rejection reason — null when the preview is clean. */
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

function monthAfter(iso: string): string {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

const TYPE_LABELS: Record<string, string> = {
  SECURITY_DEPOSIT: 'Deposit',
  MAINTENANCE: 'Maintenance',
};

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
  let rentLabeled = false;
  for (const alloc of preview.allocations) {
    if (alloc.allocated <= 0) continue;
    if (alloc.type === 'RENT') {
      const month = alloc.rent_month ? monthShortLabel(alloc.rent_month) : 'Rent';
      const label = rentLabeled ? month : `${month} rent`;
      rentLabeled = true;
      lines.push({ key: alloc.obligation_id, label, amount: alloc.allocated });
    } else {
      lines.push({ key: alloc.obligation_id, label: TYPE_LABELS[alloc.type] || alloc.type, amount: alloc.allocated });
    }
  }

  let outstandingLabel: string | null = null;
  if (monthlyRent > 0) {
    const rentAllocs = preview.allocations
      .filter((a) => a.type === 'RENT' && a.rent_month)
      .sort((a, b) => new Date(a.rent_month as string).getTime() - new Date(b.rent_month as string).getTime());
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
  let warning: string | null = null;
  if (overpaidAmount > 0) {
    warning = `₹${overpaidAmount.toLocaleString('en-IN')} is more than what's owed and won't be recorded`;
  } else if (!preview.payment_accepted && preview.rejection_reason) {
    warning = preview.rejection_reason;
  }

  return {
    headline: `₹${paidAmount.toLocaleString('en-IN')} received`,
    lines,
    outstandingLabel,
    remainingOutstanding: Math.max(preview.remaining_outstanding, 0),
    overpaidAmount,
    warning,
  };
}
