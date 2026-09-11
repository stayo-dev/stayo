/**
 * Subscription lifecycle sweep (ADR-172, Phase 3) — automatic expiry.
 *
 * Business rule: when a paid period ends and there is no approved renewal
 * extending it and no valid admin override, the subscription becomes `PAUSED`.
 * **There is no grace period.** No `RENEWAL_DUE` / `PAYMENT_FAILED` / `EXPIRING`.
 *
 * Runs from `/api/cron/subscription-lifecycle` under the `system_locks` guard.
 * Idempotent: the pause write is status-guarded (`WHERE status = 'ACTIVE'`), so
 * a re-run pauses nothing already paused, and an override or a renewal that
 * pushed `current_period_end` forward is respected on every pass.
 *
 * SYSTEM is the actor for the events this emits.
 */
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";

export const SYSTEM_ACTOR = "SYSTEM" as const;

/** Pure — is this subscription past its paid period with nothing extending access? */
export function shouldPause(
  sub: {
    status: string;
    current_period_end: Date | string | null;
    admin_override_until: Date | string | null;
  },
  now: Date = new Date(),
): boolean {
  if (String(sub.status).toUpperCase() !== "ACTIVE") return false;
  if (!sub.current_period_end) return false;

  const periodEnd = new Date(sub.current_period_end).getTime();
  if (now.getTime() < periodEnd) return false; // period not over — no grace, exact boundary

  const overrideUntil = sub.admin_override_until ? new Date(sub.admin_override_until).getTime() : null;
  if (overrideUntil !== null && overrideUntil >= now.getTime()) return false; // valid override holds access

  return true;
}

export type ExpirySweepResult = {
  scanned: number;
  paused: number;
  held_by_override: number;
  ran_at: string;
};

/**
 * Pause every subscription whose paid period has ended without renewal/override.
 * Safe to run repeatedly and concurrently (the pause update is status-guarded).
 */
async function runExpirySweep(now: Date = new Date()): Promise<ExpirySweepResult> {
  // Candidates: ACTIVE with a period end on or before now.
  const candidates = await prisma.owner_subscriptions.findMany({
    where: { status: "ACTIVE", current_period_end: { lte: now } },
    select: { id: true, owner_id: true, current_period_end: true, admin_override_until: true, status: true },
  });

  let paused = 0;
  let heldByOverride = 0;

  for (const sub of candidates) {
    if (!shouldPause(sub, now)) {
      heldByOverride += 1;
      continue;
    }
    const res = await prisma.owner_subscriptions.updateMany({
      where: { id: sub.id, status: "ACTIVE" }, // idempotent guard
      data: { status: "PAUSED", updated_at: now },
    });
    if (res.count === 1) {
      paused += 1;
      await eventLog.log("SUBSCRIPTION_PAUSED", sub.owner_id, {
        actor: SYSTEM_ACTOR,
        subscription_id: sub.id,
        reason: "PERIOD_ENDED_NO_RENEWAL",
        period_end: sub.current_period_end ? new Date(sub.current_period_end).toISOString() : null,
      });
    }
  }

  return {
    scanned: candidates.length,
    paused,
    held_by_override: heldByOverride,
    ran_at: now.toISOString(),
  };
}

export const subscriptionLifecycleService = {
  runExpirySweep,
  shouldPause,
  SYSTEM_ACTOR,
};
