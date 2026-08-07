/**
 * Money formatting and empty-state rules for the admin Revenue screen.
 *
 * Pure, so both are testable in the node-only environment — and so the
 * "is there anything here at all?" question is answered in one place rather
 * than re-derived by each block on the page.
 */

/** Full precision, Indian grouping. For a single headline figure. */
export function formatINR(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '₹0';
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

/**
 * Compact Indian form — ₹4.2L, ₹1.3Cr — for figures that sit in a row of
 * stats where the full number would either wrap or be unreadable at a glance.
 *
 * Lakh/crore rather than K/M: this is an Indian product, and ₹12L is the way
 * the number is actually said.
 */
export function formatCompactINR(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '₹0';

  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';

  if (abs >= 10_000_000) return `${sign}₹${trim(abs / 10_000_000)}Cr`;
  if (abs >= 100_000) return `${sign}₹${trim(abs / 100_000)}L`;
  if (abs >= 1_000) return `${sign}₹${trim(abs / 1_000)}K`;
  return `${sign}₹${Math.round(abs)}`;
}

/** One decimal, but never a trailing `.0`. */
function trim(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export type RevenueKpis = {
  mrr: number;
  arr: number;
  collected_this_month: number;
  pending_collections: number;
  lifetime_revenue: number;
};

/**
 * Has anything ever happened on this screen?
 *
 * Drives whether the page shows its working furniture — search, six status
 * filters, a billing-cycle toggle and four export buttons — or a single
 * honest explanation. Rendering all of that above "No hostels have a
 * subscription yet" gives an admin controls that filter nothing and exports
 * that produce empty files.
 */
export function hasRevenueActivity(kpis: RevenueKpis | undefined, subscriptionCount: number): boolean {
  if (subscriptionCount > 0) return true;
  if (!kpis) return false;
  return (
    Number(kpis.lifetime_revenue) > 0 ||
    Number(kpis.mrr) > 0 ||
    Number(kpis.collected_this_month) > 0 ||
    Number(kpis.pending_collections) > 0
  );
}

/**
 * ARR is MRR × 12 by definition, so showing them as two independent cards
 * invites an admin to read them as separate measurements. Returns the
 * relationship to state under ARR, or null when there is nothing to relate.
 */
export function describeArr(kpis: RevenueKpis | undefined): string | null {
  if (!kpis) return null;
  const mrr = Number(kpis.mrr);
  if (!Number.isFinite(mrr) || mrr <= 0) return null;
  return `${formatCompactINR(mrr)} × 12 months`;
}
