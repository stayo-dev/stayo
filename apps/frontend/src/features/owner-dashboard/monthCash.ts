/**
 * The month card's arithmetic: what came in, what went out, what is left.
 *
 * The home page used to show only money **in** — "August Collection, ₹16,000
 * of ₹57,000". That answers *how much have I collected*, never *am I ahead*,
 * and ₹16,000 collected means something very different against ₹4,000 of
 * spending than against ₹30,000 of it.
 *
 * Two things this deliberately does not do:
 *
 * 1. **It never calls the result profit.** `left` is cash received minus cash
 *    spent. It ignores unpaid dues, deposits held, and anything accrued — so
 *    the card says "Left", and the caller must not relabel it. This codebase
 *    has a standing rule against presenting a plausible number as a real one
 *    (the hostel builder shows no revenue figure at all for the same reason).
 * 2. **It does not treat a negative month as an error.** Spending more than
 *    you collected is an ordinary month for a hostel — a deposit refunded, a
 *    roof repaired — and the card has to render it as a fact rather than
 *    clamping it to zero or overflowing its bar.
 *
 * PURE MODULE — `apps/frontend` tests run without a DOM, and money that
 * renders wrong is the worst thing this app can do.
 */

export interface MonthCashInput {
  /** Rupees actually received this month. */
  collected: number;
  /** Rupees spent this month. */
  spent: number;
  /** The month's billed target, for the collection percentage. */
  target: number;
}

export interface MonthCash {
  collected: number;
  spent: number;
  /** `collected - spent`. Negative when the month cost more than it brought in. */
  left: number;
  /** True when spending exceeded what came in — the card says so plainly. */
  overspent: boolean;
  /** 0–100. How much of the month's bill has been collected. */
  collectedPct: number;
  /** 0–100. How much of what came in has already gone out. */
  spentShareOfCollected: number;
}

const safe = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const clampPct = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

export function monthCash(input: MonthCashInput): MonthCash {
  // Negative inputs are not a state this app produces; treating them as zero
  // keeps one bad row from rendering a bar backwards.
  const collected = Math.max(0, safe(input?.collected));
  const spent = Math.max(0, safe(input?.spent));
  const target = Math.max(0, safe(input?.target));

  const left = collected - spent;

  return {
    collected,
    spent,
    left,
    overspent: left < 0,
    // A zero target is a month with nothing billed yet, not a divide-by-zero.
    collectedPct: target > 0 ? clampPct((collected / target) * 100) : 0,
    // Spending more than came in fills the bar rather than running past it.
    spentShareOfCollected: collected > 0 ? clampPct((spent / collected) * 100) : spent > 0 ? 100 : 0,
  };
}

/**
 * The label under the figure.
 *
 * "Left" is only true when something is left. Saying "Left −₹2,300" reads as a
 * rendering bug; saying "Overspent by ₹2,300" reads as the month it was.
 */
export function leftLabel(cash: MonthCash): string {
  return cash.overspent ? 'Overspent by' : 'Left';
}
