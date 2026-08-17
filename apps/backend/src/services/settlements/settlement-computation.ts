/**
 * What Stayo owes each owner for a given day.
 *
 * Stayo pools tenant rent in its own Razorpay account and passes it through
 * IN FULL — no commission. This module decides which money is the owner's and
 * groups it per owner. It never applies a fee, and there is no gross-vs-net.
 *
 * The rule everything rests on: settleability comes from the GATEWAY ledger,
 * never from `payments.payment_method`. An owner marking rent as "UPI"
 * produces a payments row but no captured transaction — that money went to
 * the owner's own UPI ID and Stayo owes nothing against it.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts. Keep it that way:
 * this is the calculation that decides how much real money leaves a bank
 * account, and it must stay trivially testable.
 */

export type GatewayTxn = {
  id: string;
  purpose: string;
  status: string;
  amount: number | string;
  owner_id: string | null;
  hostel_id: string | null;
  captured_at: Date | string | null;
};

export type SettlementItemDraft = {
  ownerId: string;
  amount: number;
  paymentCount: number;
  transactionIds: string[];
  byHostel: { hostelId: string; amount: number; count: number }[];
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Is this money the owner's, and does Stayo actually hold it?
 *
 * Four ways the answer is no, and each has cost someone money somewhere:
 *  - OWNER_SUBSCRIPTION: Stayo's own revenue. Owners pay it into the same
 *    account; settling it would hand Stayo's income straight back.
 *  - not CAPTURED: authorized, failed or refunded money is not in the account.
 *  - no owner: nobody to pay. Settling it would be impossible anyway, but it
 *    must not silently join another owner's total.
 *  - non-positive: a zero or negative row is a data problem, not a payout.
 */
export function isSettleable(txn: GatewayTxn): boolean {
  if (txn.purpose !== "TENANT_RENT") return false;
  if (txn.status !== "CAPTURED") return false;
  if (!txn.owner_id) return false;
  return num(txn.amount) > 0;
}

/** One draft item per owner, largest amount first. */
export function groupIntoItems(transactions: GatewayTxn[]): SettlementItemDraft[] {
  const byOwner = new Map<string, SettlementItemDraft>();

  for (const txn of transactions ?? []) {
    // Filtered before summing, never after — a subscription must not even
    // briefly contribute to an owner's total.
    if (!isSettleable(txn)) continue;

    const ownerId = String(txn.owner_id);
    const amount = num(txn.amount);

    let item = byOwner.get(ownerId);
    if (!item) {
      item = { ownerId, amount: 0, paymentCount: 0, transactionIds: [], byHostel: [] };
      byOwner.set(ownerId, item);
    }

    item.amount += amount;
    item.paymentCount += 1;
    item.transactionIds.push(txn.id);

    if (txn.hostel_id) {
      const hostelId = String(txn.hostel_id);
      const row = item.byHostel.find((h) => h.hostelId === hostelId);
      if (row) {
        row.amount += amount;
        row.count += 1;
      } else {
        item.byHostel.push({ hostelId, amount, count: 1 });
      }
    }
  }

  return [...byOwner.values()]
    .map((item) => ({
      ...item,
      // Money is compared and displayed to 2dp; floating addition of many
      // rupee amounts otherwise leaves 14500.000000000002 in a payout screen.
      amount: round2(item.amount),
      byHostel: item.byHostel.map((h) => ({ ...h, amount: round2(h.amount) })),
    }))
    .sort((a, b) => b.amount - a.amount);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * The half-open UTC window covering one IST calendar day.
 *
 * Half-open ([from, to)) on purpose: consecutive days share a boundary
 * instant, so a payment captured exactly at midnight belongs to exactly one
 * run. Overlapping bounds would let it be settled twice.
 */
export function istDayBounds(isoDate: string): { from: Date; to: Date } {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const midnightUtc = new Date(`${isoDate}T00:00:00.000Z`).getTime();
  const from = new Date(midnightUtc - IST_OFFSET_MS);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}
