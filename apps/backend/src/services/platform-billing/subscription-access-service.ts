/**
 * Subscription access enforcement (ADR-172, Phase 3).
 *
 * `requireActiveSubscription(ownerId)` is the reusable server-side gate for
 * owner mutations that manage Stayo data. It is NOT global Next.js middleware —
 * it is called explicitly at the point of the protected mutation, with the
 * ownerId resolved from the authenticated session (never the request body).
 *
 * Access rules:
 *   - status === ACTIVE                         → allowed
 *   - a valid admin override (until >= now,     → allowed (temporary)
 *     and status !== CANCELLED)
 *   - PENDING_PAYMENT / PAUSED / EXPIRED / TRIAL → blocked
 *   - CANCELLED                                 → blocked
 *   - missing / unknown subscription            → blocked
 *
 * Enforcement is gated by `PLATFORM_BILLING_ENFORCED` (see `billing-flags.ts`).
 * While off, a would-be block is logged (`SUBSCRIPTION_ENFORCEMENT_SKIPPED`)
 * and the action is allowed — the warn-only ramp before every owner has a
 * backfilled ACTIVE subscription.
 */
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { SubscriptionError } from "./subscription-errors";
import { isBillingEnforced } from "./billing-flags";

export type SubscriptionAccessDecision = {
  allowed: boolean;
  reason:
    | "ACTIVE"
    | "ADMIN_OVERRIDE"
    | "NO_SUBSCRIPTION"
    | "PENDING_PAYMENT"
    | "PAUSED"
    | "EXPIRED"
    | "TRIAL"
    | "CANCELLED"
    | "UNKNOWN_STATUS";
  status: string | null;
  override_until: Date | null;
};

type MinimalSubscription = {
  status: string;
  admin_override_until: Date | null;
} | null;

/** Pure — decides access from a subscription row + the current time. */
export function decideSubscriptionAccess(
  subscription: MinimalSubscription,
  now: Date = new Date(),
): SubscriptionAccessDecision {
  if (!subscription) {
    return { allowed: false, reason: "NO_SUBSCRIPTION", status: null, override_until: null };
  }
  const status = String(subscription.status || "").toUpperCase();
  const overrideUntil = subscription.admin_override_until ? new Date(subscription.admin_override_until) : null;
  const overrideValid = overrideUntil !== null && overrideUntil.getTime() >= now.getTime();

  if (status === "ACTIVE") {
    return { allowed: true, reason: "ACTIVE", status, override_until: overrideUntil };
  }
  if (status !== "CANCELLED" && overrideValid) {
    return { allowed: true, reason: "ADMIN_OVERRIDE", status, override_until: overrideUntil };
  }
  switch (status) {
    case "PENDING_PAYMENT":
      return { allowed: false, reason: "PENDING_PAYMENT", status, override_until: overrideUntil };
    case "PAUSED":
      return { allowed: false, reason: "PAUSED", status, override_until: overrideUntil };
    case "EXPIRED":
      return { allowed: false, reason: "EXPIRED", status, override_until: overrideUntil };
    case "TRIAL":
      return { allowed: false, reason: "TRIAL", status, override_until: overrideUntil };
    case "CANCELLED":
      return { allowed: false, reason: "CANCELLED", status, override_until: overrideUntil };
    default:
      return { allowed: false, reason: "UNKNOWN_STATUS", status, override_until: overrideUntil };
  }
}

const BLOCK_MESSAGES: Record<SubscriptionAccessDecision["reason"], string> = {
  ACTIVE: "",
  ADMIN_OVERRIDE: "",
  NO_SUBSCRIPTION: "This Stayo account has no active subscription. Complete payment to start managing your hostels.",
  PENDING_PAYMENT: "Your Stayo subscription is awaiting payment. Complete and submit your payment to activate the platform.",
  PAUSED: "Your Stayo subscription is paused. Renew your subscription to resume managing your hostels.",
  EXPIRED: "Your Stayo subscription has ended. Renew to resume managing your hostels.",
  TRIAL: "Your Stayo subscription is not active. Complete payment to continue.",
  CANCELLED: "Your Stayo subscription is cancelled. Contact Stayo to reactivate.",
  UNKNOWN_STATUS: "Your Stayo subscription is not in a usable state. Contact Stayo.",
};

/**
 * Throw `SubscriptionError('SUBSCRIPTION_INACTIVE', 402)` unless this owner's
 * subscription grants access. Pass `tx` to read (and hold a row lock) inside an
 * open transaction — `plan-capacity-service` does this for race safety.
 */
export async function requireActiveSubscription(
  ownerId: string,
  opts: { tx?: any; now?: Date; context?: string } = {},
): Promise<SubscriptionAccessDecision> {
  const db = opts.tx ?? prisma;
  const now = opts.now ?? new Date();

  const subscription: MinimalSubscription = await db.owner_subscriptions.findUnique({
    where: { owner_id: ownerId },
    select: { status: true, admin_override_until: true },
  });

  const decision = decideSubscriptionAccess(subscription, now);
  if (decision.allowed) return decision;

  if (!isBillingEnforced()) {
    await eventLog.log("SUBSCRIPTION_ENFORCEMENT_SKIPPED", ownerId, {
      gate: "requireActiveSubscription",
      reason: decision.reason,
      status: decision.status,
      context: opts.context ?? null,
    });
    return decision;
  }

  throw new SubscriptionError(
    BLOCK_MESSAGES[decision.reason] || BLOCK_MESSAGES.UNKNOWN_STATUS,
    "SUBSCRIPTION_INACTIVE",
    402,
  );
}
