/**
 * What the owner reads when a tenant says they have paid.
 *
 * Pure module, no React — the frontend suite is node-only, and this is the
 * copy on a screen that moves real money. Confirming a claim records rent; the
 * wording has to make clear what the owner is being asked to vouch for, and
 * has to stop short of implying Stayo verified anything. It did not: with the
 * gateway gone there is no callback and no third party (ADR-235).
 */

export type PaymentClaim = {
  id: string;
  tenant_name: string;
  hostel_name: string;
  rent_month: string | null;
  /** Integer paise. */
  claimed_amount: number;
  /** Set when the tenant paid something other than what the link asked for. */
  mismatch_note: string | null;
  utr: string;
  proof_url: string | null;
  state: string;
  created_at: string;
};

export function formatPaise(paise: number): string {
  return `₹${Math.round((Number(paise) || 0) / 100).toLocaleString('en-IN')}`;
}

/**
 * "2 hours ago", "yesterday", "3 days ago".
 *
 * A claim's age is the owner's cue that somebody is waiting. An absolute
 * timestamp would make him do the arithmetic.
 */
export function waitingFor(createdAt: string, now: Date = new Date()): string {
  const then = new Date(createdAt).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.max(0, Math.floor((now.getTime() - then) / 60000));
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/**
 * The heading above the list.
 *
 * Names the count, because the number of people waiting is the only thing that
 * decides whether the owner opens this now or later.
 */
export function claimsHeading(count: number): string {
  if (count === 0) return 'No payments waiting';
  if (count === 1) return '1 payment to confirm';
  return `${count} payments to confirm`;
}

/**
 * What confirming actually does, said before he taps it.
 *
 * Deliberately not "Verify": Stayo has verified nothing. The owner is the one
 * asserting the money arrived, and the copy has to place that responsibility
 * with him rather than implying a check that never happened.
 */
export const CONFIRM_LABEL = 'Mark as received';
export const REJECT_LABEL = "Didn't arrive";

export const CONFIRM_HELP =
  'Check this reference against your bank statement first. Confirming records the rent and sends the tenant a receipt.';

/**
 * A one-line summary of the claim, for the collapsed row.
 *
 * Leads with the amount and the month, because that is what the owner matches
 * against. The reference is shown separately and in full — truncating the one
 * field he has to compare character by character would defeat the point.
 */
export function claimSummary(claim: PaymentClaim): string {
  const parts = [formatPaise(claim.claimed_amount)];
  if (claim.rent_month) parts.push(claim.rent_month);
  return parts.join(' · ');
}
