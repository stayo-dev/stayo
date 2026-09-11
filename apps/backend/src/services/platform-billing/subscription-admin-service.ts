/**
 * Admin subscription operations (ADR-172, Phase 5).
 *
 * Pause / resume / change-plan, plus the admin console's list + detail reads.
 * Every mutation goes through the existing state machine (`canTransition`) and
 * FOUNDING guard (`reserveFoundingSlotInTx`), and is audited via `eventLog`
 * with the admin as actor. No shortcut ever activates a subscription without a
 * payment — that stays `subscription-payment-service.reviewPayment`.
 *
 * Admin overrides (`extend`) are `subscription-override-service`, not here.
 */
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { SubscriptionError } from "./subscription-errors";
import { subscriptionService } from "./subscription-service";
import { canTransition, computePlanTotalPaise, effectivePlanCapacity, FOUNDING_PLAN_CODE, validateExtraBeds, type SubscriptionStatus } from "./subscription-rules";

type Tx = any;

async function loadSubscription(subscriptionId: string) {
  const sub = await prisma.owner_subscriptions.findUnique({ where: { id: subscriptionId } });
  if (!sub) throw new SubscriptionError("Subscription not found.", "NOT_FOUND", 404);
  return sub;
}

// ── pause ─────────────────────────────────────────────────────────────────
async function pause(params: { subscriptionId: string; adminId: string; reason: string | null | undefined }) {
  const reason = String(params.reason || "").trim();
  if (!reason) throw new SubscriptionError("A reason is required to pause a subscription.", "REASON_REQUIRED", 400);

  const sub = await loadSubscription(params.subscriptionId);
  if (sub.status === "PAUSED") {
    return { id: sub.id, status: "PAUSED" as const, changed: false };
  }
  const guard = canTransition(sub.status as SubscriptionStatus, "PAUSED");
  if (!guard.ok) throw new SubscriptionError(guard.reason, "INVALID_TRANSITION", 409);

  const updated = await prisma.owner_subscriptions.update({
    where: { id: sub.id, status: sub.status } as any,
    data: { status: "PAUSED", updated_at: new Date() },
  });
  await eventLog.log("SUBSCRIPTION_PAUSED", sub.owner_id, {
    actor: "ADMIN",
    admin_id: params.adminId,
    subscription_id: sub.id,
    reason,
    previous_status: sub.status,
  });
  return { id: updated.id, status: updated.status, changed: true };
}

// ── resume ────────────────────────────────────────────────────────────────
/**
 * Bring a paused/expired subscription back to `PENDING_PAYMENT` — a controlled
 * step: it unblocks the owner to pay, it does NOT grant paid access. To grant
 * access, use `extend` (admin override).
 */
async function resume(params: { subscriptionId: string; adminId: string; reason: string | null | undefined }) {
  const reason = String(params.reason || "").trim();
  if (!reason) throw new SubscriptionError("A reason is required to resume a subscription.", "REASON_REQUIRED", 400);

  const sub = await loadSubscription(params.subscriptionId);
  if (sub.status !== "PAUSED" && sub.status !== "EXPIRED") {
    throw new SubscriptionError(
      `Only a paused or expired subscription can be resumed (this one is ${sub.status}).`,
      "INVALID_TRANSITION",
      409,
    );
  }
  const guard = canTransition(sub.status as SubscriptionStatus, "PENDING_PAYMENT");
  if (!guard.ok) throw new SubscriptionError(guard.reason, "INVALID_TRANSITION", 409);

  const updated = await prisma.owner_subscriptions.update({
    where: { id: sub.id, status: sub.status } as any,
    data: { status: "PENDING_PAYMENT", updated_at: new Date() },
  });
  await eventLog.log("SUBSCRIPTION_RESUMED", sub.owner_id, {
    actor: "ADMIN",
    admin_id: params.adminId,
    subscription_id: sub.id,
    reason,
    previous_status: sub.status,
    new_status: "PENDING_PAYMENT",
    note: "Owner must submit a payment (or the admin must extend) to regain access.",
  });
  return { id: updated.id, status: updated.status };
}

// ── change plan ───────────────────────────────────────────────────────────
async function changePlan(params: {
  subscriptionId: string;
  adminId: string;
  planId: string;
  effective: "IMMEDIATE" | "NEXT_PERIOD";
  reason: string | null | undefined;
  /**
   * Extra beds to set on the subscription (business rules, 2026-09-10) —
   * IMMEDIATE only; validated against `newPlan`'s allowance. Not carried over
   * implicitly from the previous plan — defaults to 0 when omitted, same
   * rule the payment-approval flow uses, so extra beds are never left
   * inconsistent with whatever plan is actually in effect. Ignored for
   * NEXT_PERIOD (nothing changes immediately; the eventual renewal payment
   * sets its own extra_beds).
   */
  extraBeds?: number;
}) {
  const reason = String(params.reason || "").trim();
  if (!reason) throw new SubscriptionError("A reason is required to change a plan.", "REASON_REQUIRED", 400);
  if (params.effective !== "IMMEDIATE" && params.effective !== "NEXT_PERIOD") {
    throw new SubscriptionError("effective must be IMMEDIATE or NEXT_PERIOD.", "VALIDATION_ERROR", 400);
  }

  const sub = await loadSubscription(params.subscriptionId);
  const [currentPlan, newPlan] = await Promise.all([
    prisma.subscription_plans.findUnique({ where: { id: sub.plan_id } }),
    prisma.subscription_plans.findUnique({ where: { id: params.planId } }),
  ]);
  if (!newPlan || !newPlan.is_active) throw new SubscriptionError("That plan does not exist or is inactive.", "PLAN_NOT_FOUND", 404);

  const extraBeds = Math.max(0, Math.trunc(params.extraBeds ?? 0));
  if (params.effective === "IMMEDIATE") {
    const extraBedsCheck = validateExtraBeds(newPlan, extraBeds);
    if (!extraBedsCheck.ok) throw new SubscriptionError(extraBedsCheck.reason, "EXTRA_BEDS_LIMIT_EXCEEDED", 409);
  }

  if (params.effective === "NEXT_PERIOD") {
    // Queue it; the Phase 3 renewal logic applies it. No FOUNDING slot is
    // consumed until the renewal actually lands (reviewPayment reserves it).
    // Extra beds (Phase 6.6): the subscription's CURRENT extra-bed count must
    // already fit the queued plan's allowance — refused up front rather than
    // silently queuing a change that would leave the renewal payment stuck
    // (the same guard `subscriptionDowngradeService.scheduleDowngrade` applies
    // to the owner's own downgrade flow).
    const currentExtraBeds = Math.max(0, Math.trunc(Number(sub.extra_beds) || 0));
    if (currentExtraBeds > 0) {
      const extraBedsCheck = validateExtraBeds(newPlan, currentExtraBeds);
      if (!extraBedsCheck.ok) {
        throw new SubscriptionError(
          `This owner currently has ${currentExtraBeds} extra beds, which ${newPlan.code} does not allow (${extraBedsCheck.reason}) Reduce their extra beds (immediate change-plan) before queuing this plan for next period.`,
          "EXTRA_BEDS_EXCEEDS_TARGET_PLAN",
          409,
        );
      }
    }

    const updated = await prisma.owner_subscriptions.update({
      where: { id: sub.id },
      data: { pending_plan_id: newPlan.id, updated_at: new Date() },
    });
    await eventLog.log("SUBSCRIPTION_PLAN_CHANGED", sub.owner_id, {
      actor: "ADMIN",
      admin_id: params.adminId,
      subscription_id: sub.id,
      from_plan: currentPlan?.code ?? null,
      to_plan: newPlan.code,
      effective: "NEXT_PERIOD",
      reason,
    });
    return { id: updated.id, plan_id: updated.plan_id, pending_plan_id: updated.pending_plan_id, effective: "NEXT_PERIOD" as const };
  }

  // IMMEDIATE: capacity + FOUNDING checked server-side, inside one transaction.
  const result = await prisma.$transaction(async (tx: Tx) => {
    await tx.$queryRaw`SELECT id FROM owner_subscriptions WHERE id = ${sub.id}::uuid FOR UPDATE`;

    // Capacity: an immediate move to a plan (+ the requested extra beds)
    // whose effective ceiling is already exceeded is refused — the admin
    // should schedule it for NEXT_PERIOD or the owner must reduce active
    // tenants first.
    const effectiveCap = newPlan.included_beds != null ? effectivePlanCapacity(newPlan, extraBeds) : newPlan.capacity_max;
    if (effectiveCap != null) {
      const activeCount = await tx.tenants.count({ where: { owner_id: sub.owner_id, status: "ACTIVE" } });
      if (activeCount > effectiveCap) {
        throw new SubscriptionError(
          `This owner has ${activeCount} active tenants; ${newPlan.code} with ${extraBeds} extra beds allows ${effectiveCap}. Schedule the change for the next renewal, request more extra beds, or reduce active tenants first.`,
          "SUBSCRIPTION_CAPACITY_REACHED",
          409,
          { current: activeCount, capacity: effectiveCap, plan: newPlan.code },
        );
      }
    }

    if (newPlan.code === FOUNDING_PLAN_CODE) {
      await subscriptionService.reserveFoundingSlotInTx(tx, sub.owner_id, newPlan.id);
    }

    const updated = await tx.owner_subscriptions.update({
      where: { id: sub.id },
      data: {
        plan_id: newPlan.id,
        pending_plan_id: null,
        extra_beds: extraBeds,
        updated_at: new Date(),
      },
    });
    return updated;
  });

  await eventLog.log("SUBSCRIPTION_PLAN_CHANGED", sub.owner_id, {
    actor: "ADMIN",
    admin_id: params.adminId,
    subscription_id: sub.id,
    from_plan: currentPlan?.code ?? null,
    to_plan: newPlan.code,
    effective: "IMMEDIATE",
    extra_beds: extraBeds,
    reason,
  });
  return { id: result.id, plan_id: result.plan_id, pending_plan_id: result.pending_plan_id, extra_beds: result.extra_beds, effective: "IMMEDIATE" as const };
}

// ── list + detail (admin console reads) ───────────────────────────────────
async function listSubscriptions(params: { status?: string; planCode?: string; search?: string; limit?: number; offset?: number } = {}) {
  const limit = Math.min(Math.max(Number(params.limit ?? 50), 1), 100);
  const offset = Math.max(Number(params.offset ?? 0), 0);
  const status = params.status?.toUpperCase();
  const planCode = params.planCode?.toUpperCase();
  const search = params.search?.trim();

  const where: any = {};
  if (status && status !== "ALL") where.status = status;
  // Filter by plan code (business rules, 2026-09-10 — Founding/Starter/Growth/
  // Professional/Portfolio). Matches the CURRENT plan, not a queued pending one.
  if (planCode && planCode !== "ALL") where.subscription_plans = { code: planCode };
  if (search) {
    where.profile = {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ],
    };
  }

  const [rows, total, statusGroups, planGroups] = await Promise.all([
    prisma.owner_subscriptions.findMany({
      where,
      orderBy: { updated_at: "desc" },
      skip: offset,
      take: limit,
      include: {
        profile: { select: { id: true, name: true, email: true, phone: true } },
        subscription_plans: {
          select: { code: true, name: true, price_paise: true, capacity_max: true, included_beds: true, max_extra_beds: true, extra_bed_price_paise: true },
        },
        pending_plan: { select: { code: true, name: true } },
      },
    }),
    prisma.owner_subscriptions.count({ where }),
    prisma.owner_subscriptions.groupBy({ by: ["status"], _count: { _all: true } }),
    // Plan-code counts for the admin filter chips (Founding/Starter/Growth/
    // Professional/Portfolio) — computed unfiltered by plan so the chips show
    // the whole distribution regardless of which one is currently selected.
    prisma.owner_subscriptions.groupBy({
      by: ["plan_id"],
      where: status && status !== "ALL" ? { status } : {},
      _count: { _all: true },
    }),
  ]);

  const ownerIds = rows.map((r: any) => r.owner_id);
  const [activeCounts, latestPayments] = await Promise.all([
    prisma.tenants.groupBy({ by: ["owner_id"], where: { owner_id: { in: ownerIds }, status: "ACTIVE" }, _count: { _all: true } }),
    prisma.subscription_payments.findMany({
      where: { owner_id: { in: ownerIds } },
      orderBy: { created_at: "desc" },
      select: { owner_id: true, status: true, amount_paise: true, payment_method: true, submitted_at: true, created_at: true },
    }),
  ]);
  const activeByOwner = new Map(activeCounts.map((r: any) => [r.owner_id, r._count._all]));
  const latestByOwner = new Map<string, any>();
  for (const p of latestPayments) if (!latestByOwner.has(p.owner_id)) latestByOwner.set(p.owner_id, p);

  // Resolve plan_id -> code for the plan-code filter-chip counts.
  const planIds = planGroups.map((g: any) => g.plan_id);
  const plansById = planIds.length
    ? new Map((await prisma.subscription_plans.findMany({ where: { id: { in: planIds } }, select: { id: true, code: true } })).map((p: any) => [p.id, p.code]))
    : new Map();
  const planCounts: Record<string, number> = {};
  for (const g of planGroups as any[]) {
    const code = plansById.get(g.plan_id);
    if (code) planCounts[code] = (planCounts[code] ?? 0) + g._count._all;
  }

  return {
    subscriptions: rows.map((r: any) => {
      const used = activeByOwner.get(r.owner_id) ?? 0;
      // Effective ceiling for THIS owner (included beds + their own paid
      // extra beds), not the plan's theoretical maximum — see
      // plan-capacity-service.effectivePlanCapacity.
      const cap =
        r.subscription_plans?.included_beds != null
          ? effectivePlanCapacity(r.subscription_plans, r.extra_beds ?? 0)
          : (r.subscription_plans?.capacity_max ?? null);
      const latest = latestByOwner.get(r.owner_id) ?? null;
      return {
        id: r.id,
        owner: r.profile,
        status: r.status,
        plan: r.subscription_plans
          ? {
              code: r.subscription_plans.code,
              name: r.subscription_plans.name,
              price_paise: r.subscription_plans.price_paise,
              included_beds: r.subscription_plans.included_beds,
              max_extra_beds: r.subscription_plans.max_extra_beds,
              extra_bed_price_paise: r.subscription_plans.extra_bed_price_paise,
            }
          : null,
        pending_plan: r.pending_plan ? { code: r.pending_plan.code, name: r.pending_plan.name } : null,
        extra_beds: r.extra_beds,
        amount_paise: r.subscription_plans?.price_paise ?? null,
        // Plan price + the recurring extra-bed charge (Phase 6.6) — what the
        // owner actually pays every period, for the admin list to surface
        // alongside the bare plan price. `amount_paise` above is kept
        // unchanged for any existing reader that expects the plan-only figure.
        recurring_amount_paise: r.subscription_plans
          ? computePlanTotalPaise(r.subscription_plans, r.extra_beds ?? 0)
          : null,
        current_period_start: r.current_period_start,
        current_period_end: r.current_period_end,
        next_renewal_at: r.next_renewal_at,
        usage: { used, capacity_max: cap, at_limit: cap != null && used >= cap },
        admin_override_until: r.admin_override_until,
        latest_payment: latest
          ? { status: latest.status, amount_paise: latest.amount_paise, payment_method: latest.payment_method, at: latest.submitted_at ?? latest.created_at }
          : null,
      };
    }),
    total,
    limit,
    offset,
    has_more: offset + rows.length < total,
    status_counts: Object.fromEntries(statusGroups.map((g: any) => [g.status, g._count._all])),
    plan_counts: planCounts,
  };
}

async function getSubscriptionDetail(subscriptionId: string) {
  const sub = await prisma.owner_subscriptions.findUnique({
    where: { id: subscriptionId },
    include: {
      profile: { select: { id: true, name: true, email: true, phone: true } },
      subscription_plans: {
        select: { id: true, code: true, name: true, price_paise: true, capacity_max: true, included_beds: true, max_extra_beds: true, extra_bed_price_paise: true },
      },
      pending_plan: { select: { id: true, code: true, name: true, price_paise: true } },
    },
  });
  if (!sub) throw new SubscriptionError("Subscription not found.", "NOT_FOUND", 404);

  const [payments, invoices, activeCount] = await Promise.all([
    prisma.subscription_payments.findMany({ where: { owner_id: sub.owner_id }, orderBy: { created_at: "desc" }, take: 30 }),
    prisma.subscription_invoices.findMany({
      where: { owner_id: sub.owner_id },
      orderBy: { issued_at: "desc" },
      take: 30,
      include: { subscription_payments: { select: { subscription_plans: { select: { name: true } } } } },
    }),
    prisma.tenants.count({ where: { owner_id: sub.owner_id, status: "ACTIVE" } }),
  ]);

  const cap =
    sub.subscription_plans?.included_beds != null
      ? effectivePlanCapacity(sub.subscription_plans, sub.extra_beds ?? 0)
      : (sub.subscription_plans?.capacity_max ?? null);
  return {
    subscription: {
      id: sub.id,
      status: sub.status,
      owner: sub.profile,
      plan: sub.subscription_plans,
      pending_plan: sub.pending_plan,
      extra_beds: sub.extra_beds,
      amount_paise: sub.subscription_plans?.price_paise ?? null,
      recurring_amount_paise: sub.subscription_plans
        ? computePlanTotalPaise(sub.subscription_plans, sub.extra_beds ?? 0)
        : null,
      current_period_start: sub.current_period_start,
      current_period_end: sub.current_period_end,
      next_renewal_at: sub.next_renewal_at,
      started_at: sub.started_at,
      cancelled_at: sub.cancelled_at,
      admin_override_until: sub.admin_override_until,
      admin_override_reason: sub.admin_override_reason,
      admin_override_by: sub.admin_override_by,
      usage: { used: activeCount, capacity_max: cap, at_limit: cap != null && activeCount >= cap },
    },
    payments: payments.map((p: any) => ({
      id: p.id,
      plan_id: p.plan_id,
      amount_paise: p.amount_paise,
      extra_beds: p.extra_beds,
      currency: p.currency,
      payment_method: p.payment_method,
      transaction_reference: p.transaction_reference,
      proof_file: p.proof_file,
      status: p.status,
      rejection_reason: p.rejection_reason,
      submitted_at: p.submitted_at,
      reviewed_at: p.reviewed_at,
      reviewed_by: p.reviewed_by,
    })),
    invoices: invoices.map((inv: any) => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      plan_name: inv.subscription_payments?.subscription_plans?.name ?? null,
      amount_paise: inv.amount_paise,
      extra_beds: inv.extra_beds,
      plan_amount_paise: inv.plan_amount_paise,
      extra_bed_unit_price_paise: inv.extra_bed_unit_price_paise,
      extra_bed_amount_paise: inv.extra_bed_amount_paise,
      tax_paise: inv.tax_paise,
      billing_period_start: inv.billing_period_start,
      billing_period_end: inv.billing_period_end,
      payment_method: inv.payment_method,
      issued_at: inv.issued_at,
      // Downloaded via GET /api/platform-admin/subscription-invoices/[id].
      document_ready: Boolean(inv.document_url),
    })),
  };
}

export const subscriptionAdminService = {
  pause,
  resume,
  changePlan,
  listSubscriptions,
  getSubscriptionDetail,
};
