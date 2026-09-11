/**
 * Owner subscription payment submission + admin review (ADR-172, Phase 2).
 *
 * Owner: submit a manual UPI / cash payment against their subscription.
 * Admin: approve (activates/updates the subscription + issues an invoice, all
 * in one transaction) or reject (reason required; subscription untouched).
 *
 * Owners can never set APPROVED — only `reviewPayment` can, and it is called
 * exclusively from an ADMIN-gated route.
 */
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { SubscriptionError } from "./subscription-errors";
import { subscriptionService } from "./subscription-service";
import { createInvoiceForApprovedPayment } from "./subscription-invoice-service";
import { computeRenewal, renewalUpdateData } from "./subscription-renewal-service";
import {
  FOUNDING_PLAN_CODE,
  REVIEWABLE_PAYMENT_STATUSES,
  canReviewPayment,
  classifyPlanChange,
  computeExpectedTotalPaise,
  computePlanTotalPaise,
  computeUpgradeProration,
  daysBetween,
  toDateOnly,
  validateExtraBeds,
  validatePaymentSubmission,
  validateRejection,
  type PlanChangeKind,
  type SubscriptionStatus,
} from "./subscription-rules";

type SubmitInput = {
  plan_id: unknown;
  amount_paise: unknown;
  currency?: unknown;
  payment_method: unknown;
  transaction_reference?: unknown;
  proof_file_url?: unknown;
  extra_beds?: unknown;
};

/** One payment awaiting review at a time — stops accidental double submits. */
async function assertNoOpenPayment(ownerId: string, actorRole: "OWNER" | "ADMIN") {
  const pending = await prisma.subscription_payments.findFirst({
    where: { owner_id: ownerId, status: { in: [...REVIEWABLE_PAYMENT_STATUSES] } },
    select: { id: true },
  });
  if (pending) {
    throw new SubscriptionError(
      actorRole === "ADMIN"
        ? "This owner already has a payment awaiting review. Approve or reject it first."
        : "You already have a payment awaiting review. Wait for it to be reviewed before submitting another.",
      "PAYMENT_ALREADY_PENDING",
      409,
    );
  }
}

/**
 * Create one SUBMITTED `subscription_payments` row. Shared by the owner's manual
 * submit and the admin's cash-record — both go through the SAME lifecycle
 * (SUBMITTED → review → APPROVED); there is no shortcut that activates a
 * subscription without a payment record + review.
 */
async function createSubmittedPayment(params: {
  ownerId: string;
  planId: string;
  amountPaise: number;
  method: string;
  transactionReference: string | null;
  proofFileUrl: string | null;
  /** who created the row — the owner for a manual submit, the admin for cash */
  actorId: string;
  actorRole: "OWNER" | "ADMIN";
  /** Extra beds beyond the plan's included_beds (business rules, 2026-09-10). */
  extraBeds?: number;
}) {
  const { ownerId, planId, amountPaise, method, transactionReference, proofFileUrl, actorId, actorRole } = params;
  const extraBeds = Math.trunc(params.extraBeds ?? 0);

  const plan = await prisma.subscription_plans.findUnique({ where: { id: planId } });
  if (!plan || !plan.is_active) {
    throw new SubscriptionError("That plan is not available.", "PLAN_NOT_FOUND", 404);
  }

  // Extra-bed quantity — validated server-side, cannot exceed the
  // plan-specific allowance. The frontend never gets to decide this.
  const extraBedsCheck = validateExtraBeds(plan, extraBeds);
  if (!extraBedsCheck.ok) throw new SubscriptionError(extraBedsCheck.reason, "EXTRA_BEDS_LIMIT_EXCEEDED", 409);

  // FOUNDING soft pre-check — the transaction-safe reservation happens at approval.
  if (plan.code === FOUNDING_PLAN_CODE && !(await subscriptionService.canOwnerTakeFounding(ownerId))) {
    throw new SubscriptionError(
      "The FOUNDING plan is limited to the first 10 owners and is full.",
      "FOUNDING_FULL",
      409,
    );
  }

  const subscription = await subscriptionService.ensureForOwner(ownerId);

  await assertNoOpenPayment(ownerId, actorRole);

  const payment = await prisma.subscription_payments.create({
    data: {
      owner_id: ownerId,
      subscription_id: subscription.id,
      plan_id: plan.id,
      amount_paise: Math.trunc(amountPaise),
      extra_beds: extraBeds,
      currency: "INR",
      payment_method: method as any,
      transaction_reference: transactionReference,
      proof_file: proofFileUrl,
      status: "SUBMITTED",
    },
  });

  await eventLog.log("SUBSCRIPTION_PAYMENT_SUBMITTED", ownerId, {
    payment_id: payment.id,
    subscription_id: subscription.id,
    plan_code: plan.code,
    amount_paise: payment.amount_paise,
    extra_beds: extraBeds,
    payment_method: method,
    recorded_by: actorRole,
    actor_id: actorId,
  });

  return payment;
}

/** Owner submits a payment. `ownerId` is the session-resolved id — never from the body. */
async function submitPayment(ownerId: string, input: SubmitInput) {
  const check = validatePaymentSubmission(input);
  if (!check.ok) throw new SubscriptionError(check.reason, "INVALID_PAYMENT", 400);

  const planId = String(input.plan_id || "");
  if (!planId) throw new SubscriptionError("plan_id is required.", "INVALID_PAYMENT", 400);

  return createSubmittedPayment({
    ownerId,
    planId,
    amountPaise: Number(input.amount_paise),
    method: String(input.payment_method).toUpperCase(),
    transactionReference: String(input.transaction_reference || "").trim() || null,
    proofFileUrl: String(input.proof_file_url || "").trim() || null,
    actorId: ownerId,
    actorRole: "OWNER",
    extraBeds: input.extra_beds !== undefined ? Number(input.extra_beds) : 0,
  });
}

/**
 * Admin records a CASH subscription payment for an owner. Creates a SUBMITTED
 * row — the admin still approves it via `reviewPayment` (the same atomic
 * transaction). Distinct from tenant-rent cash: this is owner → Stayo.
 */
async function recordCashPayment(
  adminId: string,
  input: { ownerId: string; planId: string; amountPaise: number; reference?: string | null; extraBeds?: number },
) {
  const ownerId = String(input.ownerId || "");
  const planId = String(input.planId || "");
  if (!ownerId || !planId) throw new SubscriptionError("ownerId and planId are required.", "INVALID_PAYMENT", 400);
  const amount = Number(input.amountPaise);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new SubscriptionError("amount_paise must be a positive whole number of paise.", "INVALID_PAYMENT", 400);
  }
  const owner = await prisma.profile.findFirst({ where: { id: ownerId, role: "OWNER" }, select: { id: true } });
  if (!owner) throw new SubscriptionError("Owner not found.", "NOT_FOUND", 404);

  return createSubmittedPayment({
    ownerId,
    planId,
    amountPaise: amount,
    method: "CASH",
    transactionReference: String(input.reference || "").trim() || null,
    proofFileUrl: null,
    actorId: adminId,
    actorRole: "ADMIN",
    extraBeds: input.extraBeds !== undefined ? Number(input.extraBeds) : 0,
  });
}

/**
 * Read-only: what an owner would pay right now, either to upgrade to
 * `targetPlanId`, or — when `targetPlanId` is their CURRENT plan — to top up
 * to `extraBeds` extra beds without changing plan (business rules,
 * 2026-09-10; e.g. a FOUNDING owner past their 250 included beds, or any
 * owner buying more beds within their plan's allowance).
 *
 * Extra beds are never prorated — always charged in full for the beds being
 * added, on top of the (unchanged) plan-price proration formula. Only the
 * INCREMENTAL beds beyond what the owner already has are charged for a
 * same-plan top-up.
 */
async function upgradePreview(ownerId: string, targetPlanId: string, extraBeds = 0) {
  const subscription = await subscriptionService.ensureForOwner(ownerId);
  if (subscription.status !== "ACTIVE" || !subscription.current_period_end || !subscription.current_period_start) {
    throw new SubscriptionError("An upgrade preview is only available on an active, paid subscription.", "NOT_ACTIVE", 409);
  }

  const [current, target] = await Promise.all([
    prisma.subscription_plans.findUnique({ where: { id: subscription.plan_id } }),
    prisma.subscription_plans.findUnique({ where: { id: targetPlanId } }),
  ]);
  if (!current || !target || !target.is_active) {
    throw new SubscriptionError("That plan is not available.", "PLAN_NOT_FOUND", 404);
  }

  const requestedExtraBeds = Math.max(0, Math.trunc(extraBeds));
  const currentExtraBeds = Math.max(0, Math.trunc(Number(subscription.extra_beds) || 0));
  const isSamePlanTopUp = target.id === current.id;

  if (isSamePlanTopUp) {
    if (requestedExtraBeds <= currentExtraBeds) {
      throw new SubscriptionError(
        "That isn't more extra beds than you already have — nothing to preview.",
        "NOT_AN_UPGRADE",
        400,
      );
    }
  } else if (target.price_paise <= current.price_paise) {
    throw new SubscriptionError("That is not an upgrade — a downgrade takes effect at the next renewal with no proration.", "NOT_AN_UPGRADE", 400);
  }
  if (target.code === FOUNDING_PLAN_CODE && !(await subscriptionService.canOwnerTakeFounding(ownerId))) {
    throw new SubscriptionError("The FOUNDING plan is full.", "FOUNDING_FULL", 409);
  }

  const extraBedsCheck = validateExtraBeds(target, requestedExtraBeds);
  if (!extraBedsCheck.ok) throw new SubscriptionError(extraBedsCheck.reason, "EXTRA_BEDS_LIMIT_EXCEEDED", 409);

  const today = toDateOnly(new Date());
  const daysInPeriod = daysBetween(subscription.current_period_start, subscription.current_period_end);
  const daysRemaining = daysBetween(today, subscription.current_period_end);

  const perBedPaise = target.extra_bed_price_paise ?? 0;
  let amountPaise: number;
  if (isSamePlanTopUp) {
    // Plan price unchanged — only the INCREMENTAL new beds are charged, in full.
    amountPaise = (requestedExtraBeds - currentExtraBeds) * perBedPaise;
  } else {
    // Plan-price delta prorated exactly as before; the target plan's full
    // requested extra-bed cost is added on top, never prorated.
    amountPaise =
      computeUpgradeProration({
        oldPricePaise: current.price_paise,
        newPricePaise: target.price_paise,
        daysRemaining,
        daysInPeriod,
      }) +
      requestedExtraBeds * perBedPaise;
  }

  return {
    current_plan: { id: current.id, code: current.code, name: current.name, price_paise: current.price_paise },
    target_plan: { id: target.id, code: target.code, name: target.name, price_paise: target.price_paise },
    days_in_period: daysInPeriod,
    days_remaining: daysRemaining,
    extra_beds: requestedExtraBeds,
    extra_bed_price_paise: perBedPaise,
    amount_paise: amountPaise,
    currency: "INR",
    effective: "IMMEDIATELY_ON_APPROVAL",
    next_renewal_price_paise: computePlanTotalPaise(target, requestedExtraBeds),
  };
}

/**
 * Read-only: what a SUBMITTED/UNDER_REVIEW payment's total SHOULD be, per the
 * same server-authoritative math the approval path uses — for detecting a
 * mismatch against what the payment actually declares (Phase 6.9). Never
 * mutates anything; never used to reject a payment or compute the invoice
 * (the invoice already derives its own amount independently at approval).
 *
 * Returns `null` only if the payment/subscription/plan rows can't be loaded
 * (e.g. a stale id) — callers treat that as "can't compute, don't warn".
 */
async function getExpectedAmount(paymentId: string): Promise<{
  kind: PlanChangeKind;
  expectedAmountPaise: number;
  declaredAmountPaise: number;
  mismatch: boolean;
} | null> {
  const payment = await prisma.subscription_payments.findUnique({ where: { id: paymentId } });
  if (!payment) return null;

  const subscription = await prisma.owner_subscriptions.findUnique({ where: { id: payment.subscription_id } });
  if (!subscription) return null;

  const [currentPlan, selectedPlan] = await Promise.all([
    prisma.subscription_plans.findUnique({ where: { id: subscription.plan_id } }),
    prisma.subscription_plans.findUnique({ where: { id: payment.plan_id } }),
  ]);
  if (!selectedPlan) return null;

  const currentExtraBeds = Math.max(0, Math.trunc(Number(subscription.extra_beds) || 0));
  const requestedExtraBeds = Math.max(0, Math.trunc(Number(payment.extra_beds) || 0));

  const kind = classifyPlanChange({
    currentStatus: subscription.status as SubscriptionStatus,
    currentPlanPricePaise: subscription.status === "ACTIVE" ? currentPlan?.price_paise ?? null : null,
    selectedPlanPricePaise: selectedPlan.price_paise,
    selectedPlanId: selectedPlan.id,
    currentPlanId: subscription.plan_id,
    pendingPlanId: subscription.pending_plan_id,
    currentExtraBeds,
    requestedExtraBeds,
  });

  let daysRemaining = 0;
  let daysInPeriod = 0;
  if (kind === "UPGRADE" && subscription.current_period_start && subscription.current_period_end) {
    const today = toDateOnly(new Date());
    daysInPeriod = daysBetween(subscription.current_period_start, subscription.current_period_end);
    daysRemaining = daysBetween(today, subscription.current_period_end);
  }

  // `payment.plan_id` is already whatever plan is actually being invoiced —
  // the current plan for a simple RENEWAL, or the queued plan when a
  // RENEWAL is landing a pending downgrade — so `selectedPlan` doubles as
  // "the invoiced plan" for every kind without a separate pending-plan read.
  const expectedAmountPaise = computeExpectedTotalPaise({
    kind,
    invoicedPlanPricePaise: selectedPlan.price_paise,
    currentPlanPricePaise: currentPlan?.price_paise ?? selectedPlan.price_paise,
    invoicedPlanExtraBedPricePaise: selectedPlan.extra_bed_price_paise,
    requestedExtraBeds,
    currentExtraBeds,
    daysRemaining,
    daysInPeriod,
  });

  const declaredAmountPaise = payment.amount_paise;
  return {
    kind,
    expectedAmountPaise,
    declaredAmountPaise,
    mismatch: declaredAmountPaise !== expectedAmountPaise,
  };
}

/** Prisma is exported as `any` (lib/db.ts) — the repo types transaction clients as `any`. */
type Tx = any;

/** Compute the subscription mutation an approved payment causes. Pure-ish (dates in). */
function planApprovalOutcome(params: {
  kind: PlanChangeKind;
  now: Date;
  selectedPlanId: string;
  selectedPlanPricePaise: number;
  paymentAmountPaise: number;
  subscription: {
    plan_id: string;
    status: SubscriptionStatus;
    started_at: Date | null;
    current_period_start: Date | null;
    current_period_end: Date | null;
    pending_plan_id: string | null;
  };
  pendingPlanPricePaise: number | null;
  /**
   * Extra beds requested by this payment (business rules, 2026-09-10). For
   * UPGRADE/NEW/RENEWAL this becomes the subscription's new `extra_beds`
   * total. DOWNGRADE never touches it — the queued plan's extra beds are
   * whatever the LATER renewal payment requests. EXTRA_BEDS uses it as the
   * subscription's new total (it is already validated > the previous total).
   * Optional/default 0 — a DOWNGRADE never reads it, so older direct callers
   * (e.g. tests exercising DOWNGRADE alone) don't need to pass it.
   */
  extraBeds?: number;
  /**
   * Extra beds already active on the subscription BEFORE this approval
   * (Phase 6.6) — needed only for `EXTRA_BEDS`, to price the invoice on the
   * INCREMENTAL beds actually bought this time (matching `upgradePreview`'s
   * same-plan-top-up formula), never the new total. Optional/default 0.
   */
  currentExtraBeds?: number;
  /**
   * Per-bed price (paise) on the plan actually paid for, and on a queued
   * pending plan (used only when a NEW/RENEWAL applies a queued downgrade) —
   * needed to add the extra-bed cost to `renewal.full_price_paise`, which
   * `computeRenewal` deliberately knows nothing about (kept pure/unchanged).
   */
  selectedPlanExtraBedPricePaise?: number | null;
  pendingPlanExtraBedPricePaise?: number | null;
}) {
  const {
    kind,
    now,
    selectedPlanId,
    selectedPlanPricePaise,
    paymentAmountPaise,
    subscription,
    pendingPlanPricePaise,
    pendingPlanExtraBedPricePaise,
  } = params;
  const extraBeds = params.extraBeds ?? 0;
  const currentExtraBeds = params.currentExtraBeds ?? 0;
  const selectedPlanExtraBedPricePaise = params.selectedPlanExtraBedPricePaise ?? null;
  const today = toDateOnly(now);

  if (kind === "UPGRADE") {
    // Immediate plan switch; period + renewal unchanged (owner already paid for it).
    // Extra-bed amount is charged in FULL for the new total (never prorated,
    // same rule `upgradePreview` uses) — fully server-computed from the
    // validated `extraBeds` count and the target plan's own price, so it can
    // never be inflated/deflated by whatever the owner typed as the payment
    // amount. The plan portion is whatever's left of the (manually verified)
    // payment amount once that server-computed extra-bed cost is removed.
    const extraBedAmountPaise = extraBeds * (selectedPlanExtraBedPricePaise ?? 0);
    return {
      data: { plan_id: selectedPlanId, pending_plan_id: null, extra_beds: extraBeds, updated_at: now },
      invoicePeriod: {
        start: subscription.current_period_start ?? today,
        end: subscription.current_period_end ?? today,
      },
      invoiceAmountPaise: paymentAmountPaise,
      planAmountPaise: paymentAmountPaise - extraBedAmountPaise,
      extraBedUnitPricePaise: extraBeds > 0 ? selectedPlanExtraBedPricePaise : null,
      extraBedAmountPaise,
      planChanged: true,
      effectivePlanId: selectedPlanId,
      clearedPending: false,
    };
  }

  if (kind === "EXTRA_BEDS") {
    // Same plan, more beds — immediate, period + renewal unchanged. Never
    // reached unless `extraBeds` is already greater than the current total
    // (classifyPlanChange only returns this kind in that case). No plan
    // component at all — the whole invoice is the INCREMENTAL new beds,
    // server-priced the same way `upgradePreview`'s same-plan-top-up branch
    // computes it (never the full new total).
    const extraBedAmountPaise = Math.max(0, extraBeds - currentExtraBeds) * (selectedPlanExtraBedPricePaise ?? 0);
    return {
      data: { extra_beds: extraBeds, updated_at: now },
      invoicePeriod: {
        start: subscription.current_period_start ?? today,
        end: subscription.current_period_end ?? today,
      },
      invoiceAmountPaise: paymentAmountPaise,
      planAmountPaise: paymentAmountPaise - extraBedAmountPaise,
      extraBedUnitPricePaise: selectedPlanExtraBedPricePaise,
      extraBedAmountPaise,
      planChanged: false,
      effectivePlanId: subscription.plan_id,
      clearedPending: false,
    };
  }

  if (kind === "DOWNGRADE") {
    // Current plan stays effective; the cheaper plan is queued for next
    // renewal. Extra beds are untouched by a downgrade schedule (the later
    // renewal payment sets its own) — this invoice (typically ₹0) carries no
    // extra-bed component.
    return {
      data: { pending_plan_id: selectedPlanId, updated_at: now },
      invoicePeriod: {
        start: subscription.current_period_start ?? today,
        end: subscription.current_period_end ?? today,
      },
      invoiceAmountPaise: paymentAmountPaise,
      planAmountPaise: paymentAmountPaise,
      extraBedUnitPricePaise: null,
      extraBedAmountPaise: 0,
      planChanged: false,
      effectivePlanId: subscription.plan_id,
      clearedPending: false,
    };
  }

  // NEW or RENEWAL — a full billing period. Applies a queued downgrade if one exists.
  const renewal = computeRenewal({
    now,
    currentStatus: subscription.status,
    currentPeriodEnd: subscription.current_period_end,
    pendingPlanId: subscription.pending_plan_id,
    pendingPlanPricePaise,
    paymentPlanId: selectedPlanId,
    paymentPlanPricePaise: selectedPlanPricePaise,
  });
  // The authoritative amount for NEW/RENEWAL is server-computed from the
  // (possibly queued-downgrade) plan's own price, never trusted from the
  // payment — extra-bed cost has to be added the same way. A renewal charges
  // the FULL recurring extra-bed total every period (it is a recurring
  // monthly add-on, not a one-off top-up), unlike EXTRA_BEDS above.
  const effectiveExtraBedPricePaise =
    (renewal.cleared_pending ? pendingPlanExtraBedPricePaise : selectedPlanExtraBedPricePaise) ?? 0;
  const extraBedsCostPaise = extraBeds * effectiveExtraBedPricePaise;

  return {
    data: { ...renewalUpdateData(renewal, { now, startedAt: subscription.started_at }), extra_beds: extraBeds },
    invoicePeriod: { start: renewal.period.start, end: renewal.period.end },
    invoiceAmountPaise: renewal.full_price_paise + extraBedsCostPaise,
    planAmountPaise: renewal.full_price_paise,
    extraBedUnitPricePaise: extraBeds > 0 ? effectiveExtraBedPricePaise : null,
    extraBedAmountPaise: extraBedsCostPaise,
    planChanged: subscription.plan_id !== renewal.effective_plan_id,
    effectivePlanId: renewal.effective_plan_id,
    clearedPending: renewal.cleared_pending,
  };
}

/**
 * Admin review of a payment. `decision` is APPROVE or REJECT. `adminId` is the
 * reviewing admin's `profiles.id`. Everything an APPROVE touches happens in one
 * transaction — payment, subscription, invoice, or nothing.
 */
async function reviewPayment(params: {
  paymentId: string;
  decision: "APPROVE" | "REJECT";
  adminId: string;
  reason?: string | null;
}) {
  const { paymentId, decision, adminId } = params;
  const reason = String(params.reason || "").trim();

  const payment = await prisma.subscription_payments.findUnique({ where: { id: paymentId } });
  if (!payment) throw new SubscriptionError("Payment not found.", "NOT_FOUND", 404);

  const reviewable = canReviewPayment(payment.status);
  if (!reviewable.ok) throw new SubscriptionError(reviewable.reason, "NOT_REVIEWABLE", 409);

  // ── REJECT ────────────────────────────────────────────────────────────────
  if (decision === "REJECT") {
    const reasonCheck = validateRejection(reason);
    if (!reasonCheck.ok) throw new SubscriptionError(reasonCheck.reason, "REASON_REQUIRED", 400);

    const res = await prisma.subscription_payments.updateMany({
      where: { id: paymentId, status: { in: [...REVIEWABLE_PAYMENT_STATUSES] } },
      data: { status: "REJECTED", rejection_reason: reason, reviewed_by: adminId, reviewed_at: new Date() },
    });
    if (res.count !== 1) throw new SubscriptionError("This payment was already reviewed.", "NOT_REVIEWABLE", 409);

    await eventLog.log("SUBSCRIPTION_PAYMENT_REJECTED", payment.owner_id, {
      actor: "ADMIN",
      admin_id: adminId,
      reviewed_by: adminId,
      payment_id: paymentId,
      subscription_id: payment.subscription_id,
      reason,
    });
    return { payment: { id: paymentId, status: "REJECTED", rejection_reason: reason }, subscription: null, invoice: null, kind: null };
  }

  // ── APPROVE (atomic) ──────────────────────────────────────────────────────
  return prisma.$transaction(async (tx: Tx) => {
    const now = new Date();

    // Flip the payment first, guarding on its still-reviewable status — a
    // concurrent approve/reject loses the race here (count !== 1).
    const flip = await tx.subscription_payments.updateMany({
      where: { id: paymentId, status: { in: [...REVIEWABLE_PAYMENT_STATUSES] } },
      data: { status: "APPROVED", reviewed_by: adminId, reviewed_at: now },
    });
    if (flip.count !== 1) throw new SubscriptionError("This payment was already reviewed.", "NOT_REVIEWABLE", 409);

    const subscription = await tx.owner_subscriptions.findUnique({ where: { id: payment.subscription_id } });
    if (!subscription) throw new SubscriptionError("The subscription for this payment no longer exists.", "NOT_FOUND", 404);

    const [currentPlan, selectedPlan] = await Promise.all([
      tx.subscription_plans.findUnique({ where: { id: subscription.plan_id } }),
      tx.subscription_plans.findUnique({ where: { id: payment.plan_id } }),
    ]);
    if (!selectedPlan) throw new SubscriptionError("The plan on this payment no longer exists.", "PLAN_NOT_FOUND", 404);

    // Normalized once — `extra_beds` defaults to 0 at the DB level, but
    // mocks/older rows may not carry it; never trust a bare `undefined` here.
    const requestedExtraBeds = Math.max(0, Math.trunc(Number(payment.extra_beds) || 0));
    const currentExtraBeds = Math.max(0, Math.trunc(Number(subscription.extra_beds) || 0));

    const kind = classifyPlanChange({
      currentStatus: subscription.status as SubscriptionStatus,
      currentPlanPricePaise: subscription.status === "ACTIVE" ? currentPlan?.price_paise ?? null : null,
      selectedPlanPricePaise: selectedPlan.price_paise,
      selectedPlanId: selectedPlan.id,
      currentPlanId: subscription.plan_id,
      pendingPlanId: subscription.pending_plan_id,
      currentExtraBeds,
      requestedExtraBeds,
    });

    // Extra-bed quantity — re-validated at approval time too (the plan's
    // allowance could have changed since submission); never exceeds the
    // plan-specific allowance.
    const extraBedsCheck = validateExtraBeds(selectedPlan, requestedExtraBeds);
    if (!extraBedsCheck.ok) throw new SubscriptionError(extraBedsCheck.reason, "EXTRA_BEDS_LIMIT_EXCEEDED", 409);

    // Payment-amount mismatch signal (Phase 6.9) — informational only. The
    // invoice below always derives its own amount independently; this never
    // blocks approval, it only surfaces (via the audit event) when what the
    // owner/admin declared doesn't match what the server would have charged.
    let daysRemainingForExpected = 0;
    let daysInPeriodForExpected = 0;
    if (kind === "UPGRADE" && subscription.current_period_start && subscription.current_period_end) {
      const today = toDateOnly(now);
      daysInPeriodForExpected = daysBetween(subscription.current_period_start, subscription.current_period_end);
      daysRemainingForExpected = daysBetween(today, subscription.current_period_end);
    }
    const expectedAmountPaise = computeExpectedTotalPaise({
      kind,
      invoicedPlanPricePaise: selectedPlan.price_paise,
      currentPlanPricePaise: currentPlan?.price_paise ?? selectedPlan.price_paise,
      invoicedPlanExtraBedPricePaise: selectedPlan.extra_bed_price_paise,
      requestedExtraBeds,
      currentExtraBeds,
      daysRemaining: daysRemainingForExpected,
      daysInPeriod: daysInPeriodForExpected,
    });
    const amountMismatch = payment.amount_paise !== expectedAmountPaise;

    // A queued downgrade's plan price, needed when a renewal applies it.
    const pendingPlan = subscription.pending_plan_id
      ? await tx.subscription_plans.findUnique({ where: { id: subscription.pending_plan_id } })
      : null;

    // FOUNDING: reserve a slot inside the transaction (advisory lock + count).
    // Guard both the payment's plan and a pending plan that a renewal will apply.
    if (selectedPlan.code === FOUNDING_PLAN_CODE) {
      await subscriptionService.reserveFoundingSlotInTx(tx, subscription.owner_id, selectedPlan.id);
    } else if (pendingPlan?.code === FOUNDING_PLAN_CODE && (kind === "NEW" || kind === "RENEWAL")) {
      await subscriptionService.reserveFoundingSlotInTx(tx, subscription.owner_id, pendingPlan.id);
    }

    const outcome = planApprovalOutcome({
      kind,
      now,
      selectedPlanId: selectedPlan.id,
      selectedPlanPricePaise: selectedPlan.price_paise,
      paymentAmountPaise: payment.amount_paise,
      pendingPlanPricePaise: pendingPlan?.price_paise ?? null,
      subscription: {
        plan_id: subscription.plan_id,
        status: subscription.status as SubscriptionStatus,
        started_at: subscription.started_at,
        current_period_start: subscription.current_period_start,
        current_period_end: subscription.current_period_end,
        pending_plan_id: subscription.pending_plan_id,
      },
      extraBeds: requestedExtraBeds,
      currentExtraBeds,
      selectedPlanExtraBedPricePaise: selectedPlan.extra_bed_price_paise,
      pendingPlanExtraBedPricePaise: pendingPlan?.extra_bed_price_paise ?? null,
    });

    const updatedSub = await tx.owner_subscriptions.update({
      where: { id: subscription.id },
      data: outcome.data as any,
    });

    const invoice = await createInvoiceForApprovedPayment(tx, {
      ownerId: subscription.owner_id,
      subscriptionId: subscription.id,
      paymentId: payment.id,
      amountPaise: outcome.invoiceAmountPaise,
      extraBeds: kind === "DOWNGRADE" ? 0 : requestedExtraBeds,
      planAmountPaise: outcome.planAmountPaise,
      extraBedUnitPricePaise: outcome.extraBedUnitPricePaise,
      extraBedAmountPaise: outcome.extraBedAmountPaise,
      paymentMethod: payment.payment_method,
      transactionReference: payment.transaction_reference,
      billingPeriodStart: outcome.invoicePeriod.start,
      billingPeriodEnd: outcome.invoicePeriod.end,
      notes:
        kind === "UPGRADE"
          ? "Prorated plan upgrade"
          : kind === "EXTRA_BEDS"
            ? "Extra beds added"
            : kind === "DOWNGRADE"
              ? "Plan downgrade — effective next renewal"
              : outcome.clearedPending
                ? "Renewal — queued downgrade applied"
                : null,
    });

    await eventLog.log("SUBSCRIPTION_PAYMENT_APPROVED", subscription.owner_id, {
      actor: "ADMIN",
      admin_id: adminId,
      reviewed_by: adminId,
      payment_id: payment.id,
      subscription_id: subscription.id,
      kind,
      extra_beds: requestedExtraBeds,
      // Extra-bed amount/unit-price audit trail (Phase 6.6) — no proof/PII,
      // just the server-computed money figures already on the invoice.
      extra_bed_amount_paise: outcome.extraBedAmountPaise,
      extra_bed_unit_price_paise: outcome.extraBedUnitPricePaise,
      plan_amount_paise: outcome.planAmountPaise,
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      amount_paise: payment.amount_paise,
      // Payment-amount mismatch signal (Phase 6.9) — the invoice above always
      // used `expected_amount_paise` (or its own server-derived equivalent
      // for NEW/RENEWAL, which never even looks at the declared amount);
      // this is purely a visibility trail for admins reviewing past
      // approvals, never a rejection or a recomputation of the invoice.
      expected_amount_paise: expectedAmountPaise,
      amount_mismatch: amountMismatch,
    });
    if (outcome.planChanged || kind === "DOWNGRADE") {
      const effectivePlan = pendingPlan && outcome.clearedPending ? pendingPlan : selectedPlan;
      await eventLog.log("SUBSCRIPTION_PLAN_CHANGED", subscription.owner_id, {
          // Triggered by an admin approving a payment (not a direct admin
        // change-plan action, but the same admin actor drove it) — see
        // subscription-admin-service.ts for the direct-action variant.
        actor: "ADMIN",
        admin_id: adminId,
        subscription_id: subscription.id,
        kind,
        from_plan: currentPlan?.code ?? null,
        to_plan: kind === "DOWNGRADE" ? selectedPlan.code : effectivePlan.code,
        effective: kind === "DOWNGRADE" ? "NEXT_RENEWAL" : "IMMEDIATE",
        pending_downgrade_applied: outcome.clearedPending,
      });
    }

    return {
      payment: { id: payment.id, status: "APPROVED" },
      subscription: {
        id: updatedSub.id,
        status: updatedSub.status,
        plan_id: updatedSub.plan_id,
        pending_plan_id: updatedSub.pending_plan_id,
        current_period_start: updatedSub.current_period_start,
        current_period_end: updatedSub.current_period_end,
        next_renewal_at: updatedSub.next_renewal_at,
      },
      invoice: { id: invoice.id, invoice_number: invoice.invoice_number, amount_paise: invoice.amount_paise },
      kind,
    };
  });
}

export const subscriptionPaymentService = {
  submitPayment,
  recordCashPayment,
  upgradePreview,
  reviewPayment,
  planApprovalOutcome,
  getExpectedAmount,
};
