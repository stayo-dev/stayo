import type { PublicPlan } from '@features/public-plans/api';

/**
 * Pure view logic for the landing page's pricing section — kept out of the
 * .tsx renderer per this app's test convention (node-env only, no jsdom).
 * Backend owns every business value (price, capacity); this only shapes it
 * into marketing copy.
 */

/** "₹2,499" — no "/month" suffix, so callers can place the cadence separately. */
export function formatMonthlyPrice(pricePaise: number): string {
  return `₹${Math.round(pricePaise / 100).toLocaleString('en-IN')}`;
}

/** "1–50 beds" / "51–100 beds" / "251+ beds" (open-ended top tier). */
export function capacityLabel(plan: Pick<PublicPlan, 'capacity_min' | 'capacity_max'>): string {
  const min = plan.capacity_min ?? 1;
  if (plan.capacity_max == null) return `${min}+ beds`;
  return `${min}–${plan.capacity_max} beds`;
}

/** Extra-bed line, or null when the plan doesn't sell extra beds (e.g. Portfolio today). */
export function extraBedLabel(plan: Pick<PublicPlan, 'max_extra_beds' | 'extra_bed_price_paise'>): string | null {
  if (!plan.max_extra_beds || plan.extra_bed_price_paise == null) return null;
  return `+${formatMonthlyPrice(plan.extra_bed_price_paise)} per extra bed beyond that`;
}

/**
 * The tier visually highlighted as "Most popular" — the middle of the public
 * lineup by price. Matches the star on the internal plans reference (Growth).
 * Falls back to no highlight for 0/1-plan lineups rather than dividing by zero.
 */
export function featuredPlanCode(plans: Pick<PublicPlan, 'code' | 'price_paise'>[]): string | null {
  if (plans.length < 2) return null;
  const sorted = [...plans].sort((a, b) => a.price_paise - b.price_paise);
  return sorted[Math.floor((sorted.length - 1) / 2)].code;
}
