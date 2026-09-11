/**
 * Pure rules for owner subscription billing (ADR-172, Phase 2).
 *
 * No I/O — every function takes plain arguments and touches nothing external,
 * so the money maths and state transitions are verifiable under
 * `vitest.pure.config.ts` without a database. The service layer
 * (`subscription-service.ts`, `subscription-payment-service.ts`) composes
 * these; it never re-derives them.
 *
 * Money is INTEGER PAISE everywhere. No GST / tax.
 */

export const CURRENCY = "INR" as const;

/** Only the first 10 owners may hold the FOUNDING plan. Enforced server-side. */
export const FOUNDING_PLAN_CODE = "FOUNDING" as const;
export const FOUNDING_MAX_OWNERS = 10;

export const SUBSCRIPTION_STATUSES = [
  "TRIAL",
  "PENDING_PAYMENT",
  "ACTIVE",
  "EXPIRED",
  "PAUSED",
  "CANCELLED",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const PAYMENT_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ["UPI_MANUAL", "CASH", "GATEWAY"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type GuardResult = { ok: true } | { ok: false; reason: string };

// ────────────────────────────────────────────────────────────────────────────
// Subscription state transitions
// ────────────────────────────────────────────────────────────────────────────

/**
 * Which target statuses a subscription may move to from each current status,
 * for the transitions Phase 2 actually performs. (Automatic EXPIRED/PAUSED by
 * the lifecycle cron is a later phase and not modelled here.)
 *
 * Stayo has NO trial: a new owner starts in PENDING_PAYMENT and NOTHING ever
 * transitions *into* TRIAL. The `TRIAL` row below only lets a hypothetical
 * legacy TRIAL row still exit; `TRIAL` is retained in the enum for schema
 * safety, not used by any flow.
 */
const ALLOWED_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  TRIAL: ["PENDING_PAYMENT", "ACTIVE", "CANCELLED"], // legacy-only exit; nothing enters TRIAL
  PENDING_PAYMENT: ["ACTIVE", "PAUSED", "CANCELLED"],
  ACTIVE: ["ACTIVE", "PENDING_PAYMENT", "PAUSED", "CANCELLED"], // ACTIVE→ACTIVE = renewal/upgrade
  EXPIRED: ["ACTIVE", "PAUSED", "CANCELLED"],
  PAUSED: ["ACTIVE", "PENDING_PAYMENT", "CANCELLED"],
  CANCELLED: [], // terminal — a cancelled owner re-subscribes via a fresh flow
};

export function canTransition(from: SubscriptionStatus, to: SubscriptionStatus): GuardResult {
  if (!SUBSCRIPTION_STATUSES.includes(from)) {
    return { ok: false, reason: `Unknown current status ${from}.` };
  }
  if (!SUBSCRIPTION_STATUSES.includes(to)) {
    return { ok: false, reason: `Unknown target status ${to}.` };
  }
  if (ALLOWED_TRANSITIONS[from].includes(to)) return { ok: true };
  return { ok: false, reason: `Cannot move a subscription from ${from} to ${to}.` };
}

// ────────────────────────────────────────────────────────────────────────────
// Payment review guards — mirrors owner-documents/document-review-guards.ts
// ────────────────────────────────────────────────────────────────────────────

export const REVIEWABLE_PAYMENT_STATUSES = ["SUBMITTED", "UNDER_REVIEW"] as const;

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return PAYMENT_METHODS.includes(String(value).toUpperCase() as PaymentMethod);
}

/** A payment can be approved/rejected only while it is still awaiting review. */
export function canReviewPayment(status: string): GuardResult {
  const s = String(status || "").toUpperCase();
  if ((REVIEWABLE_PAYMENT_STATUSES as readonly string[]).includes(s)) return { ok: true };
  if (s === "APPROVED") return { ok: false, reason: "This payment was already approved." };
  if (s === "REJECTED") {
    return { ok: false, reason: "This payment was already rejected — the owner must submit a new one." };
  }
  return { ok: false, reason: `Cannot review a payment with status ${s}.` };
}

/** A rejection must say why — the owner is shown it. Approving needs no reason. */
export function validateRejection(reason: string | null | undefined): GuardResult {
  if (!String(reason || "").trim()) {
    return { ok: false, reason: "A reason is required when rejecting a payment — the owner is shown it." };
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Payment submission validation
// ────────────────────────────────────────────────────────────────────────────

export type SubmitPaymentInput = {
  amount_paise: unknown;
  payment_method: unknown;
  currency?: unknown;
  transaction_reference?: unknown;
  proof_file_url?: unknown;
  extra_beds?: unknown;
};

export function validatePaymentSubmission(input: SubmitPaymentInput): GuardResult {
  const amount = Number(input.amount_paise);
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, reason: "amount_paise must be a positive whole number of paise." };
  }
  if (input.extra_beds !== undefined) {
    const extraBeds = Number(input.extra_beds);
    if (!Number.isInteger(extraBeds) || extraBeds < 0) {
      return { ok: false, reason: "extra_beds must be a whole number of 0 or more." };
    }
  }
  if (!isPaymentMethod(input.payment_method)) {
    return { ok: false, reason: "payment_method must be one of UPI_MANUAL, CASH, GATEWAY." };
  }
  const method = String(input.payment_method).toUpperCase() as PaymentMethod;
  if (method === "GATEWAY") {
    // Phase 2 has no gateway. The enum value exists for the future only.
    return { ok: false, reason: "GATEWAY payments are not available yet — use UPI_MANUAL or CASH." };
  }
  if (input.currency !== undefined && String(input.currency).toUpperCase() !== CURRENCY) {
    return { ok: false, reason: `currency must be ${CURRENCY}.` };
  }
  const ref = String(input.transaction_reference || "").trim();
  if (method === "UPI_MANUAL") {
    if (!ref) {
      return { ok: false, reason: "transaction_reference (the UPI reference / UTR) is required for a manual UPI payment." };
    }
    if (!String(input.proof_file_url || "").trim()) {
      return { ok: false, reason: "proof_file_url (a payment screenshot) is required for a manual UPI payment." };
    }
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Billing period maths (monthly)
// ────────────────────────────────────────────────────────────────────────────

/** A billing period expressed as calendar dates (no time component). */
export type BillingPeriod = { start: Date; end: Date; nextRenewal: Date };

function addMonthsUtc(date: Date, months: number): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const target = new Date(d);
  target.setUTCMonth(target.getUTCMonth() + months);
  // Guard month-length overflow (e.g. Jan 31 + 1mo): clamp to the last day.
  if (target.getUTCDate() !== d.getUTCDate()) {
    target.setUTCDate(0);
  }
  return target;
}

/** Truncate to a UTC calendar date. */
export function toDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * The billing period an approved NEW / RENEWAL payment creates.
 * `anchor` is where the new period starts — for a first activation this is
 * "today"; for a renewal it is the previous period's end (so late payment does
 * not shift the billing date).
 */
export function computeBillingPeriod(anchor: Date, months = 1): BillingPeriod {
  const start = toDateOnly(anchor);
  const end = addMonthsUtc(start, months);
  return { start, end, nextRenewal: end };
}

/** Whole days between two calendar dates (b - a). Never negative. */
export function daysBetween(a: Date, b: Date): number {
  const ms = toDateOnly(b).getTime() - toDateOnly(a).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

// ────────────────────────────────────────────────────────────────────────────
// Plan change classification + upgrade proration
// ────────────────────────────────────────────────────────────────────────────

export type PlanChangeKind = "NEW" | "RENEWAL" | "UPGRADE" | "DOWNGRADE" | "EXTRA_BEDS";

/**
 * Classify what an approved payment does, from the subscription's current
 * status + the price of the current vs the selected plan.
 *
 * `EXTRA_BEDS` (business rules, 2026-09-10) is additive to the existing four
 * kinds: an ACTIVE owner submitting a payment for their SAME plan but MORE
 * extra beds than they currently have — e.g. a FOUNDING owner topping up past
 * their 250 included beds, or a STARTER owner buying a few more within their
 * 10-extra-bed allowance without changing plan. Applied immediately, like an
 * UPGRADE, but the billing period is untouched (unlike RENEWAL, which this
 * would otherwise fall into via the `selectedPlanId === currentPlanId` case
 * below). Only an *increase* is special-cased here — the current
 * `selectedPlanId === currentPlanId` → RENEWAL path is unchanged for every
 * other same-plan resubmission (equal or fewer beds).
 */
export function classifyPlanChange(params: {
  currentStatus: SubscriptionStatus;
  currentPlanPricePaise: number | null;
  selectedPlanPricePaise: number;
  selectedPlanId: string;
  currentPlanId: string | null;
  /** A queued downgrade (Phase 2). A payment for the pending plan is the renewal that applies it. */
  pendingPlanId?: string | null;
  /** Extra beds currently active on the subscription (business rules, 2026-09-10). */
  currentExtraBeds?: number;
  /** Extra beds requested by this payment. */
  requestedExtraBeds?: number;
}): PlanChangeKind {
  const {
    currentStatus,
    currentPlanPricePaise,
    selectedPlanPricePaise,
    selectedPlanId,
    currentPlanId,
    pendingPlanId,
    currentExtraBeds,
    requestedExtraBeds,
  } = params;

  // A payment for the already-queued downgrade plan is the renewal that lands it,
  // never a fresh downgrade — regardless of current status.
  if (pendingPlanId && selectedPlanId === pendingPlanId) return "RENEWAL";

  // Not currently on a paid, live plan → this payment starts one.
  if (currentStatus !== "ACTIVE" || currentPlanPricePaise === null) return "NEW";

  if (selectedPlanId === currentPlanId) {
    if (
      requestedExtraBeds !== undefined &&
      currentExtraBeds !== undefined &&
      requestedExtraBeds > currentExtraBeds
    ) {
      return "EXTRA_BEDS";
    }
    return "RENEWAL";
  }
  if (selectedPlanPricePaise > currentPlanPricePaise) return "UPGRADE";
  if (selectedPlanPricePaise < currentPlanPricePaise) return "DOWNGRADE";
  // Same price, different plan id — treat as a renewal on the selected plan.
  return "RENEWAL";
}

/**
 * Upgrade proration (ADR-172 §7):
 *
 *   (new_plan_price - old_plan_price) × days_remaining / days_in_current_period
 *
 * Integer paise. Half-up rounding applied ONCE to the final result. A
 * non-positive result (shouldn't happen for a real upgrade) clamps to 0.
 */
export function computeUpgradeProration(params: {
  oldPricePaise: number;
  newPricePaise: number;
  daysRemaining: number;
  daysInPeriod: number;
}): number {
  const { oldPricePaise, newPricePaise, daysRemaining, daysInPeriod } = params;
  if (daysInPeriod <= 0) return Math.max(0, newPricePaise - oldPricePaise);
  const remaining = Math.min(Math.max(0, daysRemaining), daysInPeriod);
  const exact = ((newPricePaise - oldPricePaise) * remaining) / daysInPeriod;
  return Math.max(0, roundHalfUp(exact));
}

/** Round to the nearest integer, halves away from zero (0.5 → 1, -0.5 → -1). */
export function roundHalfUp(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** paise → "₹1,499.00" for display / logs. */
export function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Included / extra beds (business rules, 2026-09-10)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The minimal plan shape every extra-bed function needs. `max_extra_beds:
 * null` means no ceiling (FOUNDING only); `0` means extra beds are not
 * offered on this plan (Portfolio, currently — see
 * docs/obsidian/Business-Rules.md, no number was invented for it).
 */
export type ExtraBedPlan = {
  included_beds: number | null;
  max_extra_beds: number | null;
  extra_bed_price_paise: number | null;
};

/**
 * The owner's effective active-tenant ceiling on `plan` with `extraBeds`
 * currently active — `included_beds + extraBeds`, or `null` (unlimited) when
 * the plan has no extra-bed ceiling. This is the number
 * `plan-capacity-service` enforces against; `subscription_plans.capacity_max`
 * (the plan's own hard ceiling assuming the MAXIMUM extra beds) stays a
 * separate, informational/display figure.
 */
export function effectivePlanCapacity(plan: ExtraBedPlan, extraBeds: number): number | null {
  if (plan.max_extra_beds === null) return null; // FOUNDING — no ceiling regardless of extraBeds
  const included = plan.included_beds ?? 0;
  return included + Math.max(0, Math.min(extraBeds, plan.max_extra_beds));
}

/**
 * Validate a requested extra-bed count against a plan's allowance. `null`
 * `max_extra_beds` (FOUNDING) never blocks. `0` (Portfolio today) blocks any
 * non-zero request outright — "not offered on this plan" is a distinct
 * message from "you've hit your allowance, upgrade".
 */
export function validateExtraBeds(plan: ExtraBedPlan, extraBeds: number): GuardResult {
  if (!Number.isInteger(extraBeds) || extraBeds < 0) {
    return { ok: false, reason: "extra_beds must be a whole number of 0 or more." };
  }
  if (extraBeds === 0) return { ok: true };
  if (plan.max_extra_beds === null) return { ok: true }; // FOUNDING — unlimited
  // Missing/zero allowance both mean "not offered on this plan" — a plan
  // fixture/row that never got `max_extra_beds` set is NOT unlimited by
  // default; it is treated the same as Portfolio's explicit `0`.
  if (plan.max_extra_beds == null || plan.max_extra_beds <= 0) {
    return { ok: false, reason: "Extra beds are not available on this plan yet." };
  }
  if (extraBeds > plan.max_extra_beds) {
    return {
      ok: false,
      reason: `This plan allows at most ${plan.max_extra_beds} extra beds. Upgrade to a higher plan for more capacity.`,
    };
  }
  return { ok: true };
}

/**
 * The full (non-prorated) price of `plan` with `extraBeds` extra beds —
 * `price_paise + extraBeds × extra_bed_price_paise`. Used for a NEW/RENEWAL
 * payment's expected total, and as the "effective price" fed into the
 * existing, unchanged `computeUpgradeProration` formula so an upgrade or a
 * same-plan extra-bed top-up prorates/charges correctly without altering that
 * formula itself.
 */
export function computePlanTotalPaise(plan: { price_paise: number } & Pick<ExtraBedPlan, "extra_bed_price_paise">, extraBeds: number): number {
  const perBed = plan.extra_bed_price_paise ?? 0;
  return plan.price_paise + Math.max(0, extraBeds) * perBed;
}

// ────────────────────────────────────────────────────────────────────────────
// Payment-amount mismatch hardening (Phase 6.9)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The amount a payment of this `kind` SHOULD total, computed the same way the
 * approval path (`subscription-payment-service.ts#planApprovalOutcome`)
 * derives the invoice — independent of whatever `amount_paise` the payment
 * itself declares. This is the single source of truth `getExpectedAmount`
 * (admin-visible mismatch signal) and `upgradePreview` both read from, so the
 * "what should this cost" math is never duplicated or allowed to drift.
 *
 * NOT used to reject a payment and NOT used to compute the invoice directly —
 * the invoice already derives its own amount independently in
 * `planApprovalOutcome`; this exists purely so a mismatch can be *detected*
 * and shown to an admin before they decide whether to approve.
 */
export function computeExpectedTotalPaise(params: {
  kind: PlanChangeKind;
  /** Price of the plan actually being invoiced (the queued/pending plan for a RENEWAL landing a downgrade). */
  invoicedPlanPricePaise: number;
  /** Price of the plan the subscription is CURRENTLY on — only used for UPGRADE proration. */
  currentPlanPricePaise: number;
  invoicedPlanExtraBedPricePaise: number | null;
  requestedExtraBeds: number;
  /** Extra beds already active before this payment — only changes the math for EXTRA_BEDS (incremental pricing). */
  currentExtraBeds: number;
  daysRemaining: number;
  daysInPeriod: number;
}): number {
  const perBed = params.invoicedPlanExtraBedPricePaise ?? 0;
  const extraBeds = Math.max(0, params.requestedExtraBeds);

  switch (params.kind) {
    case "DOWNGRADE":
      // A downgrade only ever schedules `pending_plan_id` — no charge is due now.
      return 0;
    case "EXTRA_BEDS":
      // Same plan, no plan component — only the INCREMENTAL new beds are billed.
      return Math.max(0, extraBeds - Math.max(0, params.currentExtraBeds)) * perBed;
    case "UPGRADE":
      return (
        computeUpgradeProration({
          oldPricePaise: params.currentPlanPricePaise,
          newPricePaise: params.invoicedPlanPricePaise,
          daysRemaining: params.daysRemaining,
          daysInPeriod: params.daysInPeriod,
        }) +
        extraBeds * perBed
      );
    case "NEW":
    case "RENEWAL":
    default:
      // A full period at the invoiced plan's own price, recurring extra beds
      // charged on the full total (never prorated, never incremental).
      return params.invoicedPlanPricePaise + extraBeds * perBed;
  }
}
