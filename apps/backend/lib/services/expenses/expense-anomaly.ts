/**
 * Whether this month's spending is worth interrupting the owner about.
 *
 * The owner home page carries one line about expenses only when something has
 * actually gone wrong. That makes the bar for firing it much higher than for
 * the same idea on the Money screen, where `expense-service` already annotates
 * every category with `anomaly: previous > 0 && trend >= 35`.
 *
 * **That rule has no floor**, and on a details page it can afford not to: a
 * category that went from ₹100 to ₹200 is +100% and gets flagged, which reads
 * as noise among nineteen other rows. On the home page it is the only thing
 * said about money going out, so a false alarm there costs the owner's trust
 * in the whole surface. This adds an absolute floor and picks a single worst
 * offender rather than listing everything that moved.
 *
 * The Money screen's own rule is deliberately left alone — it is a different
 * surface with a different tolerance, and changing it was not asked for.
 *
 * Amounts are rupees (`expenses.amount` is `Decimal(10,2)`), not paise.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export interface CategorySpend {
  category: string;
  /** This month, in rupees. */
  current: number;
  /** The same category last month, in rupees. */
  previous: number;
}

export interface SpendAnomaly {
  category: string;
  current: number;
  previous: number;
  /** How many more rupees left the account than last month. Always > 0. */
  riseAmount: number;
  /** Percentage rise, rounded. */
  changePct: number;
}

/** A rise smaller than this is not worth a line on the home page, whatever the percentage. */
export const MIN_RISE_RUPEES = 1000;

/** And a rise this small in relative terms is ordinary variation, whatever the amount. */
export const MIN_RISE_PCT = 35;

/**
 * The one category worth mentioning, or null.
 *
 * Ranked by **how much more money left the account**, not by percentage. A
 * ₹12,000 rise on a ₹40,000 category is the owner's problem this month; a
 * 300% rise on a ₹400 category is arithmetic. Percentage still has to clear
 * its own floor, so a large but proportionate rise on a large category does
 * not fire either.
 */
export function detectSpendAnomaly(rows: CategorySpend[]): SpendAnomaly | null {
  const candidates: SpendAnomaly[] = [];

  for (const row of rows ?? []) {
    const current = Number(row?.current ?? 0);
    const previous = Number(row?.previous ?? 0);
    if (!Number.isFinite(current) || !Number.isFinite(previous)) continue;

    // No baseline, no claim. A category the owner spent nothing on last month
    // might be a new supplier, a one-off repair, or the first month they
    // bothered recording it — none of which is an anomaly, and "up ∞%" is not
    // a sentence anyone should read.
    if (previous <= 0) continue;

    const riseAmount = current - previous;
    if (riseAmount < MIN_RISE_RUPEES) continue;

    const changePct = Math.round((riseAmount / previous) * 100);
    if (changePct < MIN_RISE_PCT) continue;

    candidates.push({ category: row.category, current, previous, riseAmount, changePct });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.riseAmount !== a.riseAmount) return b.riseAmount - a.riseAmount;
    // Stable, so the home page does not show a different category on each load
    // when two rose by exactly the same amount.
    return a.category.localeCompare(b.category);
  });

  return candidates[0];
}
