/**
 * 🏗️ Settlement Planner — Pure Domain Module
 *
 * The SINGLE source of truth for settlement priority, obligation tiers,
 * allocation logic, payability predicates, and minimum payment computation.
 *
 * Properties:
 * - Pure function — no Prisma, no I/O, no side effects
 * - Unit-testable without mocks
 * - Consumed by: settlement-preview, create-intent, _settleTenantRentPaymentInTx, receipts
 *
 * IMPORTANT: If you change priority order here, also update the SQL CASE WHEN
 * in _settleTenantRentPaymentInTx() FOR UPDATE query to match.
 */

// ── Payability Predicates ─────────────────────────────────────────────────────
// These are the SINGLE SOURCE OF TRUTH for whether an obligation can accept
// money, receive reminders, or incur late fees.
//
// Payment eligibility, due dates, reminders, late fees, and obligation lifecycle
// are INDEPENDENT business concepts. Never use status directly to gate payments.
//
// Status     | Payable | Remindable | LateFeeEligible
// UPCOMING   |   ✅    |     ❌     |       ❌
// PENDING    |   ✅    |     ✅     |    after grace
// PARTIAL    |   ✅    |     ✅     |    after grace
// OVERDUE    |   ✅    |     ✅     |       ✅
// PAID       |   ❌    |     ❌     |       ❌
// WAIVED     |   ❌    |     ❌     |       ❌

const NON_PAYABLE_STATUSES = new Set(["PAID", "WAIVED", "CANCELLED", "DRAFT"]);
const NON_REMINDABLE_STATUSES = new Set(["PAID", "WAIVED", "CANCELLED", "DRAFT", "UPCOMING"]);

/**
 * Shared UTC-midnight due-date comparison. Single source for the date math
 * duplicated across isRemindable/isLateFeeEligible/isOverdue.
 *
 * Uses UTC getters (getUTCFullYear/etc), not local getters, on BOTH sides —
 * due_date columns are always UTC-midnight-anchored business dates (see
 * agreement-rent-schedule-service.ts's firstOfUtcMonth/dueDateForMonth), so
 * "today" must be read the same way to stay consistent. Reading `today` via
 * local getters on a non-UTC server (e.g. IST, UTC+5:30) shifts the
 * effective calendar day by up to 5.5 hours relative to `due_date`'s UTC
 * anchoring, causing an off-by-one-day misclassification for roughly 5.5
 * hours out of every 24 (matches the timezone-leakage pattern already
 * fixed once in this codebase for monthly collection metrics).
 */
function isPastDueDate(dueDate: Date, today: Date): boolean {
  const todayMid = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dueMid = new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate()));
  return dueMid.getTime() < todayMid.getTime();
}

/** Can this obligation accept payment? Status is NEVER a payment gate except for terminal states. */
export function isPayable(obligation: { status: string }): boolean {
  return !NON_PAYABLE_STATUSES.has(obligation.status);
}

/** Should this obligation trigger reminders? Only for current/overdue obligations past due date. */
export function isRemindable(obligation: { status: string; due_date: Date }, today: Date = new Date()): boolean {
  if (NON_REMINDABLE_STATUSES.has(obligation.status)) return false;
  return isPastDueDate(obligation.due_date, today);
}

/** Should this obligation incur late fees? Only if remindable AND past grace period. */
export function isLateFeeEligible(
  obligation: { status: string; due_date: Date },
  today: Date = new Date(),
  graceDays: number = 0
): boolean {
  if (!isRemindable(obligation, today)) return false;
  const todayMid = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dueMid = new Date(Date.UTC(
    obligation.due_date.getUTCFullYear(), obligation.due_date.getUTCMonth(), obligation.due_date.getUTCDate()
  ));
  const daysOverdue = Math.ceil((todayMid.getTime() - dueMid.getTime()) / 86_400_000);
  return daysOverdue > graceDays;
}

/**
 * Is money genuinely overdue by calendar date, independent of whether the
 * status label has been synced yet? Unlike isRemindable, this does NOT
 * exclude UPCOMING — a stale UPCOMING row whose due_date has already passed
 * (a transient pre-sync state) still counts as overdue here. Dashboard
 * aggregates that need to keep an UPCOMING bucket mutually exclusive from an
 * overdue bucket should additionally guard on `status !== "UPCOMING"`
 * themselves — see financial-service.ts:getTenantDues().
 */
export function isOverdue(obligation: { status: string; due_date: Date }, today: Date = new Date()): boolean {
  return isPayable(obligation) && isPastDueDate(obligation.due_date, today);
}

/** All statuses that can accept payment allocation. Used by settlement queries. Must match isPayable(). */
export const PAYABLE_STATUSES = ["OVERDUE", "PENDING", "PARTIAL", "UPCOMING"] as const;

// ── The canonical priority order ──────────────────────────────────────────────
// Security Deposit → Admission/Maintenance → Rent → Late Fees → Extra Charges
//
// Rationale (from business rules):
//   1. SECURITY_DEPOSIT first — guarantees onboarding compliance, held asset
//   2. ADMISSION — one-time admission fee, part of move-in costs
//   3. MAINTENANCE — recurring operational charge, same tier as admission
//   4. RENT — primary recurring obligation
//   5. LATE_FEE — penalty charges, generated organically from overdue rent
//   6. EXTRA_CHARGE — ad-hoc charges, lowest urgency
//
// Within each type: partial first → overdue first → oldest due_date first.
//
// ⚠️  THIS IS THE SINGLE SOURCE OF TRUTH.
//     Do NOT hardcode priority in SQL CASE statements.
//     Use buildSqlPriorityCaseClause() to generate SQL from this constant.

export const SETTLEMENT_PRIORITY: Record<string, number> = {
  SECURITY_DEPOSIT: 1,
  ADMISSION: 2,
  MAINTENANCE: 3,
  RENT: 4,
  LATE_FEE: 5,
  FINE: 5,               // Same tier as LATE_FEE — penalties
  EXTRA_CHARGE: 6,
  DAMAGE: 6,             // Same tier as EXTRA_CHARGE — ad-hoc
  UTILITY: 6,            // Same tier as EXTRA_CHARGE — ad-hoc
  ADDITIONAL_CHARGE: 6,  // Same tier as EXTRA_CHARGE — ad-hoc
  OTHER: 7,              // Lowest priority — catch-all
};

/** Ordered list of obligation types by settlement priority (highest first). */
export const SETTLEMENT_PRIORITY_ORDER: string[] = Object.entries(SETTLEMENT_PRIORITY)
  .sort(([, a], [, b]) => a - b)
  .map(([type]) => type);

/** Get the numeric priority index for an obligation type. Unknown types get 99 (settled last). */
export function priorityIndex(obligationType: string): number {
  return SETTLEMENT_PRIORITY[obligationType] ?? 99;
}

/**
 * Generate a SQL CASE WHEN clause for obligation_type priority ordering.
 * Use this in FOR UPDATE queries to ensure lock acquisition order matches
 * the canonical settlement priority.
 *
 * @param columnName - SQL column name (default: "obligation_type")
 * @returns SQL fragment like: CASE obligation_type WHEN 'SECURITY_DEPOSIT' THEN 1 ... ELSE 99 END
 */
export function buildSqlPriorityCaseClause(columnName = "obligation_type"): string {
  const cases = SETTLEMENT_PRIORITY_ORDER
    .map((type, idx) => `WHEN '${type}' THEN ${idx + 1}`)
    .join(" ");
  return `CASE ${columnName} ${cases} ELSE 99 END`;
}

// ── Obligation tiers for minimum payment grouping ─────────────────────────────
// When partial payments are disabled, the minimum = sum of all outstanding
// obligations in the first INCOMPLETE tier.
//
// Tier 1 (Onboarding): Security Deposit + Admission + Maintenance → move-in costs
// Tier 2 (Recurring):  Rent → monthly obligations
// Tier 3 (Penalties):  Late Fees → automatically generated penalties
// Tier 4 (Other):      Extra Charges → ad-hoc charges

export const SETTLEMENT_TIERS: Record<string, string> = {
  SECURITY_DEPOSIT: "ONBOARDING",
  ADMISSION: "ONBOARDING",
  MAINTENANCE: "ONBOARDING",
  RENT: "RECURRING",
  LATE_FEE: "PENALTIES",
  FINE: "PENALTIES",
  EXTRA_CHARGE: "ADHOC",
  DAMAGE: "ADHOC",
  UTILITY: "ADHOC",
  ADDITIONAL_CHARGE: "ADHOC",
  OTHER: "ADHOC",
};

const TIER_ORDER = ["ONBOARDING", "RECURRING", "PENALTIES", "ADHOC"];

const TIER_LABELS: Record<string, string> = {
  ONBOARDING: "Onboarding Dues",
  RECURRING: "Rent",
  PENALTIES: "Late Fees & Fines",
  ADHOC: "Additional Charges",
};

export const TYPE_LABELS: Record<string, string> = {
  SECURITY_DEPOSIT: "Security Deposit",
  ADMISSION: "Admission Fee",
  MAINTENANCE: "Maintenance",
  RENT: "Rent",
  LATE_FEE: "Late Fee",
  FINE: "Fine",
  EXTRA_CHARGE: "Extra Charge",
  DAMAGE: "Damage Charge",
  UTILITY: "Utility Charge",
  ADDITIONAL_CHARGE: "Additional Charge",
  OTHER: "Other Charge",
};

// ── Input types ───────────────────────────────────────────────────────────────

export interface ObligationSnapshot {
  id: string;
  obligation_type: string;
  amount: number;          // total due (rupees)
  paid: number;            // already paid (rupees)
  due_date: Date;
  rent_month: Date | null;
  owner_id: string;
  status: string;
}

export interface PaymentPolicy {
  allow_partial: boolean;
  minimum_amount: number;  // hostel-configured floor (rupees)
}

// ── Output types ──────────────────────────────────────────────────────────────

export interface SettlementAllocation {
  obligation_id: string;
  type: string;
  tier: string;
  label: string;
  rent_month: Date | null;
  amount_due: number;
  outstanding: number;
  allocated: number;
  result: "PAID" | "PARTIAL" | "UNCHANGED";
}

export interface SettlementExplanation {
  /** Human-readable description of this allocation decision */
  text: string;
  /** Which obligation this explanation relates to (null for general) */
  obligation_id: string | null;
  /** Category: why this allocation was made or skipped */
  reason: "PRIORITY" | "CHRONOLOGICAL" | "POLICY" | "CUSTOM_SELECTION" | "INSUFFICIENT_FUNDS" | "SKIPPED" | "FUTURE_CREDIT";
}

export interface SkippedObligation {
  obligation_id: string;
  type: string;
  label: string;
  outstanding: number;
  reason: string;
}

export interface SettlementPlan {
  allocations: SettlementAllocation[];
  /**
   * Money the planner could not place on any obligation (ADR-036). This is an
   * ERROR condition, never a balance — StayO no longer holds future rent
   * credit. The payment service generates the tenant's next installment(s)
   * before planning, so a well-formed call should always see 0 here; the
   * engine refuses to settle a plan with anything left over.
   */
  unallocated: number;
  total_outstanding: number;
  total_to_settle: number;
  remaining_outstanding: number;
  minimum_allowed: number;
  first_tier_label: string;
  payment_accepted: boolean;
  rejection_reason: string | null;
  payment_policy: "FULL_PAYMENT" | "PARTIAL_ALLOWED";
  warnings: string[];
  summary: string;

  /** Human-readable reasoning for each allocation decision (for AI, WhatsApp, audit) */
  explanation: SettlementExplanation[];
  /** Obligations that exist but weren't allocated to, with reasons */
  skipped_obligations: SkippedObligation[];
  /** 0-100 confidence score for the suggested allocation */
  recommendation_score: number;
}

// ── Sort ──────────────────────────────────────────────────────────────────────

export function sortObligationsByPriority<T extends { obligation_type: string; due_date: Date; rent_month: Date | null }>(
  obligations: T[]
): T[] {
  return [...obligations].sort((a, b) => {
    const pa = SETTLEMENT_PRIORITY[a.obligation_type] ?? 99;
    const pb = SETTLEMENT_PRIORITY[b.obligation_type] ?? 99;
    if (pa !== pb) return pa - pb;
    const dateDiff = new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    if (dateDiff !== 0) return dateDiff;
    if (a.rent_month && b.rent_month) {
      return new Date(a.rent_month).getTime() - new Date(b.rent_month).getTime();
    }
    return 0;
  });
}

// ── Label helper ──────────────────────────────────────────────────────────────

function buildAllocationLabel(obligationType: string, rentMonth: Date | null): string {
  const monthLabel = rentMonth
    ? new Date(rentMonth).toLocaleDateString("en-IN", { month: "short", year: "numeric" })
    : "";
  const typeLabel = TYPE_LABELS[obligationType] || obligationType;
  return monthLabel ? `${monthLabel} ${typeLabel}` : typeLabel;
}

/**
 * Verifies that for any checked RENT obligation, all prior outstanding RENT obligations
 * are also checked. If there is a "gap" in the selection, it is invalid.
 */
export function validateChronology(
  allObligations: ObligationSnapshot[],
  allowedObligationIds?: string[]
): { valid: boolean; reason?: string } {
  if (!allowedObligationIds) return { valid: true };

  // Filter and sort all RENT obligations chronologically by due_date or rent_month
  const rentObligations = allObligations
    .filter(ob => ob.obligation_type === "RENT")
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

  // Find the highest index of selected rent obligation
  let latestCheckedIndex = -1;
  for (let i = 0; i < rentObligations.length; i++) {
    if (allowedObligationIds.includes(rentObligations[i].id)) {
      latestCheckedIndex = i;
    }
  }

  // Ensure all rent obligations up to latestCheckedIndex are also checked
  for (let i = 0; i < latestCheckedIndex; i++) {
    if (!allowedObligationIds.includes(rentObligations[i].id)) {
      const monthLabel = rentObligations[i].rent_month
        ? new Date(rentObligations[i].rent_month).toLocaleDateString("en-IN", { month: "short", year: "numeric" })
        : "Prior Rent";
      const targetLabel = rentObligations[latestCheckedIndex].rent_month
        ? new Date(rentObligations[latestCheckedIndex].rent_month).toLocaleDateString("en-IN", { month: "short", year: "numeric" })
        : "Later Rent";
      return {
        valid: false,
        reason: `Prior rent obligation (${monthLabel}) must be selected before selecting later rent obligation (${targetLabel}).`,
      };
    }
  }

  return { valid: true };
}

// ── The planner ───────────────────────────────────────────────────────────────

export function buildSettlementPlan(
  rawObligations: ObligationSnapshot[],
  amountRupees: number,
  policy: PaymentPolicy,
  allowedObligationIds?: string[]
): SettlementPlan {
  if (allowedObligationIds) {
    const chronoCheck = validateChronology(rawObligations, allowedObligationIds);
    if (!chronoCheck.valid) {
      return {
        allocations: [],
        unallocated: amountRupees,
        total_outstanding: rawObligations.reduce((sum, ob) => sum + Math.max(ob.amount - ob.paid, 0), 0),
        total_to_settle: 0,
        remaining_outstanding: rawObligations.reduce((sum, ob) => sum + Math.max(ob.amount - ob.paid, 0), 0),
        minimum_allowed: 0,
        first_tier_label: "",
        payment_accepted: false,
        rejection_reason: chronoCheck.reason || "Chronological rent rule violation",
        payment_policy: "PARTIAL_ALLOWED",
        warnings: [],
        summary: "",
        explanation: [{
          text: chronoCheck.reason || "Chronological rent rule violation",
          obligation_id: null,
          reason: "CHRONOLOGICAL",
        }],
        skipped_obligations: [],
        recommendation_score: 0,
      };
    }
  }

  const obligationsToAllocate = allowedObligationIds
    ? rawObligations.filter(ob => allowedObligationIds.includes(ob.id))
    : rawObligations;

  const obligations = sortObligationsByPriority(obligationsToAllocate);
  const amountPaisa = Math.round(amountRupees * 100);
  let remainingPaisa = amountPaisa;

  // ── 1. Compute allocations ──────────────────────────────────────────────────
  const allocations: SettlementAllocation[] = [];
  let totalOutstandingPaisa = 0;

  for (const ob of obligations) {
    const duePaisa = Math.round(ob.amount * 100);
    const paidPaisa = Math.round(ob.paid * 100);
    const outstandingPaisa = Math.max(duePaisa - paidPaisa, 0);
    if (outstandingPaisa <= 0) continue;

    totalOutstandingPaisa += outstandingPaisa;

    const allocPaisa = Math.min(remainingPaisa, outstandingPaisa);
    const result: "PAID" | "PARTIAL" | "UNCHANGED" = allocPaisa <= 0
      ? "UNCHANGED"
      : (paidPaisa + allocPaisa >= duePaisa ? "PAID" : "PARTIAL");

    const tier = SETTLEMENT_TIERS[ob.obligation_type] || "OTHER";
    const label = buildAllocationLabel(ob.obligation_type, ob.rent_month);

    allocations.push({
      obligation_id: ob.id,
      type: ob.obligation_type,
      tier,
      label,
      rent_month: ob.rent_month,
      amount_due: duePaisa / 100,
      outstanding: outstandingPaisa / 100,
      allocated: allocPaisa / 100,
      result,
    });

    remainingPaisa -= allocPaisa;
  }

  const unallocatedPaisa = Math.max(remainingPaisa, 0);
  const unallocated = unallocatedPaisa / 100;
  const totalOutstanding = totalOutstandingPaisa / 100;
  const totalToSettlePaisa = amountPaisa - unallocatedPaisa;
  const totalToSettle = totalToSettlePaisa / 100;
  const remainingOutstanding = Math.max(totalOutstanding - totalToSettle, 0);

  // ── 2. Compute minimum allowed payment (by tier) ────────────────────────────
  let minimumAllowed: number;
  let firstTierLabel = "";

  if (totalOutstanding === 0) {
    // No outstanding obligations — any positive amount becomes future credit
    minimumAllowed = 1;
    firstTierLabel = "Future Rent Credit";
  } else if (policy.allow_partial) {
    // Partial payments allowed — use hostel-configured minimum or ₹1
    minimumAllowed = Math.max(policy.minimum_amount, 1);
    // Find the label for the first outstanding obligation for UI context
    const firstOutstanding = allocations.find(a => a.outstanding > 0);
    firstTierLabel = firstOutstanding?.label || "";
  } else {
    // Full payment required — minimum = sum of first incomplete tier
    const tierTotals: Record<string, { total: number; label: string }> = {};
    for (const alloc of allocations) {
      if (alloc.outstanding <= 0) continue;
      // Look up raw obligation to skip UPCOMING
      const rawOb = rawObligations.find(o => o.id === alloc.obligation_id);
      if (rawOb && rawOb.status === "UPCOMING") continue;

      if (!tierTotals[alloc.tier]) {
        tierTotals[alloc.tier] = {
          total: 0,
          label: TIER_LABELS[alloc.tier] || alloc.label,
        };
      }
      tierTotals[alloc.tier].total += alloc.outstanding;
    }

    const firstIncompleteTier = TIER_ORDER.find(t => tierTotals[t]);
    if (firstIncompleteTier && tierTotals[firstIncompleteTier]) {
      minimumAllowed = tierTotals[firstIncompleteTier].total;
      firstTierLabel = tierTotals[firstIncompleteTier].label;
    } else {
      minimumAllowed = 1;
    }
  }

  // ── 3. Validate ─────────────────────────────────────────────────────────────
  const paymentAccepted = amountRupees >= minimumAllowed;
  let rejectionReason: string | null = null;
  if (!paymentAccepted) {
    rejectionReason = policy.allow_partial
      ? `Minimum payment is ₹${minimumAllowed.toLocaleString("en-IN")}`
      : `Full payment required. Minimum: ₹${minimumAllowed.toLocaleString("en-IN")} (${firstTierLabel})`;
  }

  // ── 4. Warnings ─────────────────────────────────────────────────────────────
  const warnings: string[] = [];
  if (unallocated > 0) {
    warnings.push(
      `₹${unallocated.toLocaleString("en-IN")} exceeds every settleable installment and cannot be accepted`,
    );
  }

  // ── 5. Explanation (human-readable reasoning) ──────────────────────────────
  const explanation: SettlementExplanation[] = [];
  const skippedObligations: SkippedObligation[] = [];

  for (const alloc of allocations) {
    if (alloc.allocated > 0) {
      const reasonCategory = allowedObligationIds ? "CUSTOM_SELECTION" : "PRIORITY";
      explanation.push({
        text: `₹${alloc.allocated.toLocaleString("en-IN")} allocated to ${alloc.label} (${alloc.result === "PAID" ? "fully settled" : "partially settled"})`,
        obligation_id: alloc.obligation_id,
        reason: reasonCategory,
      });
    } else if (alloc.outstanding > 0) {
      skippedObligations.push({
        obligation_id: alloc.obligation_id,
        type: alloc.type,
        label: alloc.label,
        outstanding: alloc.outstanding,
        reason: "Insufficient funds after higher-priority obligations",
      });
      explanation.push({
        text: `${alloc.label} (₹${alloc.outstanding.toLocaleString("en-IN")} outstanding) — skipped, insufficient funds`,
        obligation_id: alloc.obligation_id,
        reason: "INSUFFICIENT_FUNDS",
      });
    }
  }

  // Obligations that were excluded by custom selection
  if (allowedObligationIds) {
    for (const ob of rawObligations) {
      if (!allowedObligationIds.includes(ob.id) && Math.max(ob.amount - ob.paid, 0) > 0) {
        const label = buildAllocationLabel(ob.obligation_type, ob.rent_month);
        skippedObligations.push({
          obligation_id: ob.id,
          type: ob.obligation_type,
          label,
          outstanding: Math.max(ob.amount - ob.paid, 0),
          reason: "Not selected by owner",
        });
      }
    }
  }

  if (unallocated > 0) {
    explanation.push({
      text: `₹${unallocated.toLocaleString("en-IN")} could not be allocated to any installment`,
      obligation_id: null,
      reason: "UNALLOCATED",
    });
  }

  // ── 6. Recommendation score ────────────────────────────────────────────────
  // 0-100: how confident are we in this suggested allocation?
  // 100 = covers all outstanding, 50 = partial coverage, 0 = rejected
  let recommendationScore: number;
  if (!paymentAccepted) {
    recommendationScore = 0;
  } else if (remainingOutstanding <= 0) {
    recommendationScore = 100;
  } else {
    recommendationScore = Math.round((totalToSettle / totalOutstanding) * 100);
  }

  // ── 7. Summary ──────────────────────────────────────────────────────────────
  const activeAllocations = allocations.filter(a => a.allocated > 0);
  let summary: string;
  if (activeAllocations.length === 0 && unallocated > 0) {
    summary = `₹${amountRupees.toLocaleString("en-IN")} → no settleable installment`;
  } else if (unallocated > 0) {
    summary = `₹${amountRupees.toLocaleString("en-IN")} → ${activeAllocations.length} obligation(s) settled, ₹${unallocated.toLocaleString("en-IN")} unallocated`;
  } else {
    summary = `₹${amountRupees.toLocaleString("en-IN")} → ${activeAllocations.length} obligation(s) settled`;
  }

  return {
    allocations,
    unallocated,
    total_outstanding: totalOutstanding,
    total_to_settle: totalToSettle,
    remaining_outstanding: remainingOutstanding,
    minimum_allowed: minimumAllowed,
    first_tier_label: firstTierLabel,
    payment_accepted: paymentAccepted,
    rejection_reason: rejectionReason,
    payment_policy: policy.allow_partial ? "PARTIAL_ALLOWED" : "FULL_PAYMENT",
    warnings,
    summary,
    explanation,
    skipped_obligations: skippedObligations,
    recommendation_score: recommendationScore,
  };
}

// ── Helpers for consumers ─────────────────────────────────────────────────────

/**
 * Convert a Prisma obligation row (with payments relation) into an ObligationSnapshot.
 * Used by settlement-preview, create-intent, and _settleTenantRentPaymentInTx.
 */
export function toObligationSnapshot(ob: {
  id: string;
  obligation_type: string;
  amount: any;
  due_date: Date;
  rent_month: Date | null;
  owner_id: string;
  payments: Array<{ amount_paid: any }>;
  status?: string;
}): ObligationSnapshot {
  return {
    id: ob.id,
    obligation_type: ob.obligation_type,
    amount: Number(ob.amount),
    paid: ob.payments.reduce((s: number, p: any) => s + Number(p.amount_paid), 0),
    due_date: new Date(ob.due_date),
    rent_month: ob.rent_month ? new Date(ob.rent_month) : null,
    owner_id: ob.owner_id,
    status: ob.status || "PENDING",
  };
}
