/**
 * Plan capacity enforcement for tenant activation (ADR-172, Phase 3).
 *
 * `assertCanActivate(ownerId)` is called server-side, inside the same
 * transaction as the `tenants.status = 'ACTIVE'` write, immediately before it.
 * It:
 *   1. locks the owner's `owner_subscriptions` row `FOR UPDATE` (race safety —
 *      two concurrent activations for the same owner serialise on this lock,
 *      so 49 + 2 requests at cap 50 cannot both succeed);
 *   2. requires an active subscription (reuses `requireActiveSubscription`);
 *   3. checks `included_beds + extra_beds` (business rules, 2026-09-10 — the
 *      owner's ACTUAL paid extra beds, never the plan's maximum) against the
 *      count of the owner's ACTIVE tenants. FOUNDING has a real, growing
 *      ceiling like every other plan (250 included, ₹10/extra bed) — the
 *      only thing unbounded is how many extra beds can be PURCHASED, not the
 *      resulting capacity. `capacity_max: null` only occurs for a legacy
 *      plan row with no `included_beds` set.
 *
 * Capacity uses the existing tenant lifecycle definition — no new occupancy
 * model. `count(tenants WHERE owner_id = ? AND status = 'ACTIVE')`; invited
 * tenants count because the invitation flow sets them `ACTIVE` on invite.
 *
 * Gated by `PLATFORM_BILLING_ENFORCED` — warn-only while off.
 */
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { SubscriptionError } from "./subscription-errors";
import { requireActiveSubscription } from "./subscription-access-service";
import { isBillingEnforced } from "./billing-flags";
import { effectivePlanCapacity, FOUNDING_PLAN_CODE } from "./subscription-rules";

/**
 * The ceiling this ACTIVATION GATE enforces — `null` for FOUNDING (business
 * rules, 2026-09-12: "no permanent purchase of additional capacity... no
 * hard maximum" — Phase 1's dynamic-billing model bills the excess at
 * renewal, it never blocks operational usage), the real
 * `effectivePlanCapacity` figure for every other plan. Deliberately SEPARATE
 * from what `loadCapacityStatus`/`getCapacityStatus` returns for DISPLAY —
 * the owner's usage card still shows the real 250-bed boundary and growing
 * excess (`FoundingBillingSection`, the owner Subscription page) even though
 * nothing here will ever actually block them.
 */
function gateCapacityMax(
  plan: { code: string; capacity_max: number | null; included_beds: number | null; max_extra_beds: number | null; extra_bed_price_paise: number | null } | null,
  extraBeds: number,
): number | null {
  if (!plan) return null;
  if (plan.code === FOUNDING_PLAN_CODE) return null;
  return plan.included_beds != null ? effectivePlanCapacity(plan, extraBeds) : (plan.capacity_max ?? null);
}

export const CAPACITY_ERROR_CODE = "SUBSCRIPTION_CAPACITY_REACHED";

export type CapacityStatus = {
  plan_code: string | null;
  capacity_max: number | null; // null = unlimited (legacy plan row missing included_beds only — not FOUNDING)
  active_count: number;
  available: number | null; // null = unlimited
  at_limit: boolean;
};

/** Pure — is there room for one more active tenant (or is `tenantId` already active)? */
export function evaluateCapacity(params: {
  capacityMax: number | null;
  activeCountExcludingTarget: number;
}): { allowed: boolean; available: number | null; atLimit: boolean } {
  const { capacityMax, activeCountExcludingTarget } = params;
  if (capacityMax === null || capacityMax === undefined) {
    return { allowed: true, available: null, atLimit: false };
  }
  const available = Math.max(0, capacityMax - activeCountExcludingTarget);
  return {
    allowed: activeCountExcludingTarget < capacityMax,
    available,
    atLimit: activeCountExcludingTarget >= capacityMax,
  };
}

async function loadCapacityStatus(ownerId: string, db: any): Promise<CapacityStatus> {
  const subscription = await db.owner_subscriptions.findUnique({
    where: { owner_id: ownerId },
    select: { plan_id: true, extra_beds: true },
  });
  const plan = subscription
    ? await db.subscription_plans.findUnique({
        where: { id: subscription.plan_id },
        select: { code: true, capacity_max: true, included_beds: true, max_extra_beds: true },
      })
    : null;
  const activeCount = await db.tenants.count({ where: { owner_id: ownerId, status: "ACTIVE" } });
  // Effective ceiling for THIS owner — included beds + the extra beds they've
  // actually paid for (never the plan's maximum possible extra beds; that
  // figure is `plan.capacity_max`, kept for display only).
  const capacityMax =
    plan?.included_beds != null
      ? effectivePlanCapacity(plan, subscription?.extra_beds ?? 0)
      : (plan?.capacity_max ?? null);
  const evalResult = evaluateCapacity({ capacityMax, activeCountExcludingTarget: activeCount });
  return {
    plan_code: plan?.code ?? null,
    capacity_max: capacityMax,
    active_count: activeCount,
    available: evalResult.available,
    at_limit: evalResult.atLimit,
  };
}

/** Read-only capacity snapshot for the owner's own subscription screen (later phase UI). */
export async function getCapacityStatus(ownerId: string): Promise<CapacityStatus> {
  return loadCapacityStatus(ownerId, prisma);
}

/**
 * Throw unless this owner may activate one more tenant right now.
 *
 * @param opts.tx       an open transaction — REQUIRED for the row lock to be
 *                      effective; falls back to `prisma` (no lock) if omitted.
 * @param opts.tenantId the tenant being activated — excluded from the count so
 *                      a no-op re-activation (new-model invitee already ACTIVE)
 *                      is not falsely blocked by the ceiling.
 * @param opts.isRenewal skip the capacity ceiling (a renewal is net-zero) but
 *                      still require an active subscription.
 */
export async function assertCanActivate(
  ownerId: string,
  opts: { tx?: any; tenantId?: string | null; isRenewal?: boolean; context?: string } = {},
): Promise<CapacityStatus> {
  try {
    return await runAssertCanActivate(ownerId, opts);
  } catch (err) {
    // A real block or validation always propagates.
    if (err instanceof SubscriptionError) throw err;
    // Any other failure (e.g. billing tables not reachable) must NOT break the
    // host tenant-activation flow while enforcement is off — the ramp.
    if (!isBillingEnforced()) {
      await eventLog
        .log("SUBSCRIPTION_ENFORCEMENT_ERROR", ownerId, {
          gate: "assertCanActivate",
          error: String((err as any)?.message || err),
          context: opts.context ?? null,
        })
        .catch(() => {});
      return { plan_code: null, capacity_max: null, active_count: 0, available: null, at_limit: false };
    }
    throw err;
  }
}

async function runAssertCanActivate(
  ownerId: string,
  opts: { tx?: any; tenantId?: string | null; isRenewal?: boolean; context?: string },
): Promise<CapacityStatus> {
  const db = opts.tx ?? prisma;

  // 1. Serialise concurrent activations for this owner.
  if (opts.tx) {
    await opts.tx.$queryRaw`SELECT id FROM owner_subscriptions WHERE owner_id = ${ownerId}::uuid FOR UPDATE`;
  }

  // 2. Active subscription required (warn-only unless enforced).
  await requireActiveSubscription(ownerId, { tx: opts.tx, context: opts.context ?? "assertCanActivate" });

  // 3. Capacity ceiling.
  const subscription = await db.owner_subscriptions.findUnique({
    where: { owner_id: ownerId },
    select: { plan_id: true, extra_beds: true },
  });
  const plan = subscription
    ? await db.subscription_plans.findUnique({
        where: { id: subscription.plan_id },
        select: { code: true, capacity_max: true, included_beds: true, max_extra_beds: true, extra_bed_price_paise: true },
      })
    : null;
  const capacityMax: number | null = gateCapacityMax(plan, subscription?.extra_beds ?? 0);

  if (capacityMax === null || opts.isRenewal) {
    return {
      plan_code: plan?.code ?? null,
      capacity_max: capacityMax,
      active_count: 0,
      available: null,
      at_limit: false,
    };
  }

  const activeCountExcludingTarget = await db.tenants.count({
    where: {
      owner_id: ownerId,
      status: "ACTIVE",
      ...(opts.tenantId ? { id: { not: opts.tenantId } } : {}),
    },
  });

  const evalResult = evaluateCapacity({ capacityMax, activeCountExcludingTarget });
  if (!evalResult.allowed) {
    if (!isBillingEnforced()) {
      await eventLog.log("SUBSCRIPTION_ENFORCEMENT_SKIPPED", ownerId, {
        gate: "assertCanActivate",
        reason: CAPACITY_ERROR_CODE,
        current: activeCountExcludingTarget,
        capacity: capacityMax,
        plan: plan?.code ?? null,
        context: opts.context ?? null,
      });
    } else {
      throw new SubscriptionError(
        `Plan capacity reached — ${plan?.code ?? "your plan"} allows ${capacityMax} active tenants and you have ${activeCountExcludingTarget}. Upgrade your subscription to add more.`,
        CAPACITY_ERROR_CODE,
        409,
        { current: activeCountExcludingTarget, capacity: capacityMax, plan: plan?.code ?? null },
      );
    }
  }

  return {
    plan_code: plan?.code ?? null,
    capacity_max: capacityMax,
    active_count: activeCountExcludingTarget,
    available: evalResult.available,
    at_limit: evalResult.atLimit,
  };
}

export const planCapacityService = {
  assertCanActivate,
  getCapacityStatus,
  evaluateCapacity,
  CAPACITY_ERROR_CODE,
};
