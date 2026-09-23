/**
 * The free-enquiry gate for a marketplace partner listing.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export const DEFAULT_FREE_QUOTA = 3;

export type QuotaDecision =
  | { action: "DELIVER"; sequence: number }
  | { action: "HOLD"; delivered: number };

/**
 * `deliveredCount` is the number of deliveries already in state `SENT` for
 * this listing — messages Meta confirmed reached the owner's phone.
 *
 * It is deliberately NOT the number of sends we attempted. Every partner
 * template carries a 12-hour Meta validity period, so an undelivered message
 * is dropped and never seen. Counting attempts would paywall an owner whose
 * phone was off, with a message telling them they had already received three
 * enquiries they never saw — the gate would read as a swindle at the exact
 * moment it has to read as fair.
 *
 * The consequence is that several enquiries arriving inside one delivery
 * window can all go out free, because none has been confirmed delivered yet.
 * That is the intended direction of error: over-delivering a free lead costs
 * us one lead, while under-delivering costs us the owner.
 */
export function decideDelivery(input: {
  deliveredCount: number;
  freeQuota?: number;
}): QuotaDecision {
  const delivered = normaliseCount(input.deliveredCount);
  const quota = normaliseQuota(input.freeQuota);

  if (delivered >= quota) return { action: "HOLD", delivered };

  return { action: "DELIVER", sequence: delivered + 1 };
}

/** Only a confirmed delivery consumes the quota. See `decideDelivery`. */
export function consumesQuota(state: string): boolean {
  return state === "SENT";
}

function normaliseCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * A quota of zero is a legitimate configuration — a listing whose owner has
 * already been approached and declined — and means every enquiry is held.
 * A missing or nonsensical quota falls back to the default rather than to
 * zero, so a bad row can never silently paywall a partner.
 */
function normaliseQuota(value: unknown): number {
  if (value === null || value === undefined) return DEFAULT_FREE_QUOTA;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_FREE_QUOTA;
  return Math.floor(n);
}
