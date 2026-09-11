/**
 * Owner-scheduled plan downgrade (ADR-172, Phase 5).
 *
 * A downgrade is scheduled, never immediate and never paid up front: it sets
 * `owner_subscriptions.pending_plan_id`, and the Phase 3 renewal logic
 * (`subscription-renewal-service` via `reviewPayment`) applies it at the next
 * renewal at the new plan's full price. The current plan and its capacity are
 * unchanged until then.
 *
 * This replaces the Phase 4 workaround of piggy-backing a downgrade on a
 * payment submission.
 */
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { SubscriptionError } from "./subscription-errors";
import { subscriptionService } from "./subscription-service";
import { validateExtraBeds } from "./subscription-rules";

/** Owner schedules a switch to a cheaper plan, effective next renewal. */
async function scheduleDowngrade(ownerId: string, targetPlanId: string) {
  const planId = String(targetPlanId || "");
  if (!planId) throw new SubscriptionError("plan_id is required.", "VALIDATION_ERROR", 400);

  const subscription = await subscriptionService.ensureForOwner(ownerId);
  if (subscription.status !== "ACTIVE") {
    throw new SubscriptionError(
      "A downgrade can only be scheduled from an active subscription.",
      "NOT_ACTIVE",
      409,
    );
  }

  const [current, target] = await Promise.all([
    prisma.subscription_plans.findUnique({ where: { id: subscription.plan_id } }),
    prisma.subscription_plans.findUnique({ where: { id: planId } }),
  ]);
  if (!target || !target.is_active) throw new SubscriptionError("That plan is not available.", "PLAN_NOT_FOUND", 404);
  if (!current) throw new SubscriptionError("Current plan not found.", "PLAN_NOT_FOUND", 404);

  if (target.id === current.id) {
    throw new SubscriptionError("That is already your current plan.", "VALIDATION_ERROR", 400);
  }
  if (target.price_paise >= current.price_paise) {
    throw new SubscriptionError(
      "That plan is not a downgrade. Use the upgrade flow to move to a higher plan.",
      "NOT_A_DOWNGRADE",
      400,
    );
  }

  // Extra beds (business rules, 2026-09-10 / Phase 6.6): a downgrade never
  // silently discards paid beds. If the owner's CURRENT extra-bed count
  // doesn't fit the target plan's allowance, the schedule is refused up
  // front — not accepted and left to fail later at the renewal payment (which
  // independently re-validates `extra_beds` against the plan being paid for
  // anyway, but a stuck renewal is a worse experience than a clear refusal
  // now). There is deliberately no auto-reduction here.
  const currentExtraBeds = Math.max(0, Math.trunc(Number(subscription.extra_beds) || 0));
  if (currentExtraBeds > 0) {
    const extraBedsCheck = validateExtraBeds(target, currentExtraBeds);
    if (!extraBedsCheck.ok) {
      throw new SubscriptionError(
        `You currently have ${currentExtraBeds} extra beds, which ${target.name} does not allow (${extraBedsCheck.reason}) Reduce your extra beds first, or contact Stayo support, before scheduling this downgrade.`,
        "EXTRA_BEDS_EXCEEDS_TARGET_PLAN",
        409,
      );
    }
  }

  const updated = await prisma.owner_subscriptions.update({
    where: { id: subscription.id },
    data: { pending_plan_id: target.id, updated_at: new Date() },
  });

  await eventLog.log("SUBSCRIPTION_DOWNGRADE_SCHEDULED", ownerId, {
    actor: "OWNER",
    subscription_id: subscription.id,
    from_plan: current.code,
    to_plan: target.code,
    effective: "NEXT_RENEWAL",
    effective_at: subscription.current_period_end ? new Date(subscription.current_period_end).toISOString() : null,
  });

  return {
    id: updated.id,
    status: updated.status,
    current_plan: { id: current.id, code: current.code, name: current.name, price_paise: current.price_paise },
    pending_plan: { id: target.id, code: target.code, name: target.name, price_paise: target.price_paise },
    current_period_end: updated.current_period_end,
    effective: "NEXT_RENEWAL" as const,
  };
}

/** Owner cancels a scheduled downgrade — the current plan simply continues. */
async function cancelPendingDowngrade(ownerId: string) {
  const subscription = await subscriptionService.ensureForOwner(ownerId);
  if (!subscription.pending_plan_id) {
    throw new SubscriptionError("There is no scheduled plan change to cancel.", "NO_PENDING_CHANGE", 409);
  }
  const pending = await prisma.subscription_plans.findUnique({ where: { id: subscription.pending_plan_id } });

  const updated = await prisma.owner_subscriptions.update({
    where: { id: subscription.id },
    data: { pending_plan_id: null, updated_at: new Date() },
  });

  await eventLog.log("SUBSCRIPTION_DOWNGRADE_CANCELLED", ownerId, {
    actor: "OWNER",
    subscription_id: subscription.id,
    cancelled_plan: pending?.code ?? null,
  });

  return { id: updated.id, status: updated.status, pending_plan: null };
}

export const subscriptionDowngradeService = {
  scheduleDowngrade,
  cancelPendingDowngrade,
};
