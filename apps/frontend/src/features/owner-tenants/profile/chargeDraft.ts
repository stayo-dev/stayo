/**
 * The rules behind creating a manual charge.
 *
 * Two things the old form got wrong, encoded here so they stay fixed:
 *
 *  - It defaulted the type to **Rent Installment** — the one type an owner
 *    should almost never create by hand, because `rentGenerationService`
 *    already generates rent every month. A manual one double-bills the tenant
 *    for a month they already owe. There is no default now; the owner picks.
 *  - It asked for the owner's password on every charge, minted an identity
 *    token, and never sent it. `POST /api/payments/obligations` accepts no
 *    token — it is owner-scoped by session — so the prompt guarded nothing
 *    while adding a step to a routine action. (Cancel and Waive *do* send
 *    theirs, and keep their prompts: those forgive money.)
 */

export interface ChargeType {
  value: string;
  label: string;
  /** One line telling the owner when this type is the right one. */
  hint: string;
  /** Whether "which month does this belong to" is a meaningful question. */
  billingMonthApplies: boolean;
  /** Set when choosing this type deserves a second thought. */
  caution?: string;
}

/**
 * Mirrors `OBLIGATION_TYPES` in `obligation-engine.ts`. A value the backend
 * rejects would only fail after the owner had filled the whole form.
 *
 * Ordered by how often an owner actually raises one by hand. Rent is last of
 * the common group and carries a caution, so it can't be the accidental pick.
 */
export const CHARGE_TYPES: ChargeType[] = [
  { value: 'UTILITY', label: 'Utility', hint: 'Electricity, water, gas', billingMonthApplies: true },
  { value: 'DAMAGE', label: 'Damage', hint: 'Repairs charged to this tenant', billingMonthApplies: false },
  { value: 'FINE', label: 'Fine', hint: 'Penalty for a rule breach', billingMonthApplies: false },
  { value: 'MAINTENANCE', label: 'Maintenance', hint: 'Monthly upkeep charge', billingMonthApplies: true },
  { value: 'EXTRA_CHARGE', label: 'Extra charge', hint: 'One-off add-on', billingMonthApplies: false },
  { value: 'ADMISSION', label: 'Admission fee', hint: 'Charged when joining', billingMonthApplies: false },
  { value: 'SECURITY_DEPOSIT', label: 'Security deposit', hint: 'Refundable at move-out', billingMonthApplies: false },
  { value: 'LATE_FEE', label: 'Late fee', hint: 'Usually added automatically', billingMonthApplies: true, caution: 'Late fees are normally applied by the reminder service.' },
  { value: 'ADDITIONAL_CHARGE', label: 'Additional charge', hint: 'Anything else billable', billingMonthApplies: false },
  { value: 'RENT', label: 'Rent installment', hint: 'For a correction only', billingMonthApplies: true, caution: 'Rent is generated automatically each month — creating one by hand can double-bill this tenant.' },
  { value: 'OTHER', label: 'Other', hint: 'Describe it below', billingMonthApplies: false },
];

export interface ChargeDraft {
  type: string;
  amount: string;
  dueDate: string;
  billingMonth: string;
  description: string;
  notes: string;
}

export interface ChargeValidation {
  valid: boolean;
  errors: Partial<Record<'type' | 'amount' | 'dueDate', string>>;
}

export function chargeTypeLabel(value: string): string {
  return CHARGE_TYPES.find((t) => t.value === value)?.label ?? value;
}

export function chargeType(value: string): ChargeType | undefined {
  return CHARGE_TYPES.find((t) => t.value === value);
}

/** Midnight UTC for a `YYYY-MM-DD` value, or null when it isn't one. */
function utcDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Every problem at once. Reporting them one per submit — which is what a
 * `toast.error` per failed check amounts to — makes the owner submit three
 * times to learn three things.
 */
export function validateChargeDraft(draft: ChargeDraft): ChargeValidation {
  const errors: ChargeValidation['errors'] = {};

  if (!draft.type.trim()) errors.type = 'Pick what this charge is for';

  const amount = Number(draft.amount);
  if (!draft.amount.trim()) errors.amount = 'Enter an amount';
  else if (!Number.isFinite(amount) || amount <= 0) errors.amount = 'Amount must be more than ₹0';

  if (!draft.dueDate.trim()) errors.dueDate = 'Pick a due date';
  else if (!utcDay(draft.dueDate)) errors.dueDate = "That date doesn't look right";

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Which month the charge is filed under, as an ISO instant.
 *
 * Computed entirely in UTC. Building it from a local-time `new Date(dueDate)`
 * — as the old form did — files a 1st-of-month charge under the *previous*
 * month for any viewer west of UTC.
 */
export function resolveBillingMonth(dueDate: string, billingMonth: string): string | null {
  const explicit = /^(\d{4})-(\d{2})$/.exec(billingMonth.trim());
  if (explicit) {
    const [, y, m] = explicit;
    return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toISOString();
  }

  const due = utcDay(dueDate);
  if (!due) return null;
  return new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), 1)).toISOString();
}

/** ISO instant for the due date itself, or null when it can't be read. */
export function resolveDueDate(dueDate: string): string | null {
  return utcDay(dueDate)?.toISOString() ?? null;
}

/** The one-line preview shown above the submit button. */
export function summariseCharge(draft: ChargeDraft): string | null {
  const amount = Number(draft.amount);
  const due = utcDay(draft.dueDate);
  if (!draft.type.trim() || !draft.amount.trim() || !Number.isFinite(amount) || amount <= 0 || !due) {
    return null;
  }

  const when = due.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
  return `₹${amount.toLocaleString('en-IN')} · ${chargeTypeLabel(draft.type)} · due ${when}`;
}
