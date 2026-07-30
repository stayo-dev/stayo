/**
 * Shared payment-related mock constants and helpers — used by Quick Collect
 * now, and by Money's collections view later. Deliberately simple
 * client-side arithmetic, not a real FIFO/settlement engine (see
 * apps/backend's `settlement-planner.ts` for what the real thing looks
 * like — out of scope for this mock phase).
 */

export const PAYMENT_MODES = ['Cash', 'UPI', 'Bank transfer'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const BILLING_FREQUENCIES = ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly'] as const;
export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number];

export interface SettlementBreakdownRow {
  label: string;
  amount: number;
}

export interface SettlementPreview {
  received: number;
  allocated: number;
  allocatedCount: number;
  futureCredit: number;
  remainingDue: number;
  breakdown: SettlementBreakdownRow[];
}

/**
 * Given an amount received and a set of selected obligations (label + amount
 * pairs, oldest-first), allocates the payment across them in order and
 * reports what's left over as future credit, or what's still owed as
 * remaining due. Mirrors the real settlement engine's FIFO *shape* without
 * its actual business rules.
 */
export function computeSettlementPreview(amountReceived: number, selected: SettlementBreakdownRow[]): SettlementPreview {
  let remaining = amountReceived;
  const breakdown: SettlementBreakdownRow[] = [];
  for (const ob of selected) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, ob.amount);
    breakdown.push({ label: ob.label, amount: applied });
    remaining -= applied;
  }
  const allocated = breakdown.reduce((sum, row) => sum + row.amount, 0);
  const totalSelected = selected.reduce((sum, ob) => sum + ob.amount, 0);
  const futureCredit = Math.max(0, amountReceived - totalSelected);
  const remainingDue = Math.max(0, totalSelected - amountReceived);
  return { received: amountReceived, allocated, allocatedCount: breakdown.length, futureCredit, remainingDue, breakdown };
}
