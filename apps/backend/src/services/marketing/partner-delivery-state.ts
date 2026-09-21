/**
 * The lifecycle of one enquiry delivered (or withheld) from a marketplace
 * partner.
 *
 *                        quota available
 *   enquiry ───────────► PENDING ──delivered──► SENT      (consumes quota)
 *      │                    │
 *      │                    ├──failed──────────► FAILED
 *      │                    └──expired─────────► EXPIRED
 *      │
 *      └─ quota exhausted ► HELD ──released────► RELEASED
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export const DELIVERY_STATES = [
  "PENDING",
  "SENT",
  "HELD",
  "RELEASED",
  "FAILED",
  "EXPIRED",
] as const;

export type DeliveryState = (typeof DELIVERY_STATES)[number];

export type DeliveryEvent = "delivered" | "failed" | "expired" | "released";

/**
 * Returns the next state, or `null` when the event does not apply — which is
 * the normal case, not an error. Meta redelivers status webhooks, and a
 * `delivered` arriving twice must not double-count against the free quota.
 * Returning `null` lets the caller skip the write entirely.
 */
export function nextDeliveryState(
  current: string,
  event: DeliveryEvent
): DeliveryState | null {
  switch (current) {
    case "PENDING":
      if (event === "delivered") return "SENT";
      if (event === "failed") return "FAILED";
      if (event === "expired") return "EXPIRED";
      return null;

    /**
     * A HELD row's own "locked" message has delivery statuses too, but they
     * change nothing: the enquiry stays withheld until the partner converts.
     * Only a claim releases it.
     */
    case "HELD":
      return event === "released" ? "RELEASED" : null;

    // Terminal. A late webhook for an already-settled delivery is ignored.
    case "SENT":
    case "RELEASED":
    case "FAILED":
    case "EXPIRED":
      return null;

    default:
      return null;
  }
}

export function isDeliveryState(value: unknown): value is DeliveryState {
  return typeof value === "string" && (DELIVERY_STATES as readonly string[]).includes(value);
}

/**
 * States in which the enquiry is withheld from the partner and therefore the
 * student is waiting on us, not on them. The 12-hour fallback that contacts
 * the student with alternatives keys off exactly this set.
 */
export function isWithheld(state: string): boolean {
  return state === "HELD";
}
