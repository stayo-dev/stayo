/**
 * Admin subscription override (ADR-172, Phase 3).
 *
 * A valid override temporarily grants access even when the paid period has
 * ended ("we'll pay tomorrow — don't pause us"). Rules:
 *   - reason is required
 *   - the actor (admin `profiles.id`) is recorded
 *   - maximum 30 days per admin action (each call sets `admin_override_until`
 *     to at most now + 30 days; repeats are allowed but each is audited)
 *   - an expired override does not keep access active (see
 *     `subscription-access-service` / `subscription-lifecycle-service`)
 *
 * Uses the existing `admin_override_until` / `admin_override_reason` /
 * `admin_override_by` columns (Phase 1). Audited via `eventLog`.
 */
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { SubscriptionError } from "./subscription-errors";

export const MAX_OVERRIDE_DAYS = 30;

/** Pure — resolve the requested window to a bounded `admin_override_until`. */
export function resolveOverrideUntil(
  input: { days?: number | string; until?: string | Date },
  now: Date = new Date(),
): { until: Date } {
  if (input.until != null) {
    const until = new Date(input.until);
    if (Number.isNaN(until.getTime())) {
      throw new SubscriptionError("`until` is not a valid date.", "OVERRIDE_INVALID", 400);
    }
    if (until.getTime() <= now.getTime()) {
      throw new SubscriptionError("An override must end in the future.", "OVERRIDE_INVALID", 400);
    }
    const maxUntil = now.getTime() + MAX_OVERRIDE_DAYS * 86_400_000;
    if (until.getTime() > maxUntil) {
      throw new SubscriptionError(
        `An override can extend access by at most ${MAX_OVERRIDE_DAYS} days per action.`,
        "OVERRIDE_TOO_LONG",
        400,
      );
    }
    return { until };
  }

  const days = Number(input.days);
  if (!Number.isFinite(days) || days <= 0) {
    throw new SubscriptionError("`days` must be a positive number.", "OVERRIDE_INVALID", 400);
  }
  if (days > MAX_OVERRIDE_DAYS) {
    throw new SubscriptionError(
      `An override can extend access by at most ${MAX_OVERRIDE_DAYS} days per action.`,
      "OVERRIDE_TOO_LONG",
      400,
    );
  }
  return { until: new Date(now.getTime() + days * 86_400_000) };
}

async function setOverride(params: {
  subscriptionId: string;
  adminId: string;
  reason: string | null | undefined;
  days?: number | string;
  until?: string | Date;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const reason = String(params.reason || "").trim();
  if (!reason) {
    throw new SubscriptionError("A reason is required for a subscription override.", "REASON_REQUIRED", 400);
  }

  const subscription = await prisma.owner_subscriptions.findUnique({ where: { id: params.subscriptionId } });
  if (!subscription) throw new SubscriptionError("Subscription not found.", "NOT_FOUND", 404);
  if (subscription.status === "CANCELLED") {
    throw new SubscriptionError("A cancelled subscription cannot be overridden.", "SUBSCRIPTION_CANCELLED", 409);
  }

  const { until } = resolveOverrideUntil({ days: params.days, until: params.until }, now);

  const updated = await prisma.owner_subscriptions.update({
    where: { id: params.subscriptionId },
    data: {
      admin_override_until: until,
      admin_override_reason: reason,
      admin_override_by: params.adminId,
      updated_at: now,
    },
  });

  await eventLog.log("SUBSCRIPTION_OVERRIDE_SET", subscription.owner_id, {
    actor: "ADMIN",
    admin_id: params.adminId,
    subscription_id: params.subscriptionId,
    // Before/after on the override itself (Phase 6.3) — not just the status,
    // so a repeated extension is traceable to what it actually changed.
    previous_override_until: subscription.admin_override_until
      ? new Date(subscription.admin_override_until).toISOString()
      : null,
    override_until: until.toISOString(),
    reason,
    previous_status: subscription.status,
  });

  return {
    id: updated.id,
    status: updated.status,
    admin_override_until: updated.admin_override_until,
    admin_override_reason: updated.admin_override_reason,
    admin_override_by: updated.admin_override_by,
  };
}

/** Clear an override before it expires. */
async function clearOverride(params: { subscriptionId: string; adminId: string; reason?: string | null }) {
  const subscription = await prisma.owner_subscriptions.findUnique({ where: { id: params.subscriptionId } });
  if (!subscription) throw new SubscriptionError("Subscription not found.", "NOT_FOUND", 404);

  const updated = await prisma.owner_subscriptions.update({
    where: { id: params.subscriptionId },
    data: { admin_override_until: null, admin_override_reason: null, admin_override_by: null, updated_at: new Date() },
  });
  await eventLog.log("SUBSCRIPTION_OVERRIDE_CLEARED", subscription.owner_id, {
    actor: "ADMIN",
    admin_id: params.adminId,
    subscription_id: params.subscriptionId,
    previous_override_until: subscription.admin_override_until
      ? new Date(subscription.admin_override_until).toISOString()
      : null,
    reason: String(params.reason || "").trim() || null,
  });
  return { id: updated.id, admin_override_until: null };
}

export const subscriptionOverrideService = {
  setOverride,
  clearOverride,
  resolveOverrideUntil,
  MAX_OVERRIDE_DAYS,
};
