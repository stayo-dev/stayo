/**
 * 🏛️ Financial Obligation Domain Types
 *
 * Central type definitions for the Financial Obligation Engine.
 * All financial services import types from HERE — not from Prisma models.
 *
 * Key design decisions:
 *   - Database table stays `rent_obligations` — zero migration risk
 *   - Code uses `FinancialObligation` everywhere
 *   - Lifecycle (ACTIVE/WAIVED/CANCELLED) and Settlement (UNPAID/PARTIAL/PAID)
 *     are separate concepts — never mixed in a single column
 *   - OVERDUE and UPCOMING are computed presentation states, never persisted
 *   - FinancialContext is the unified input for all financial operations
 */

import type { ObligationType } from "./obligation-engine";

// ── Lifecycle Status ─────────────────────────────────────────────────────────
// Represents the business state of an obligation.
// Lifecycle transitions: ACTIVE → WAIVED | CANCELLED
// Once WAIVED or CANCELLED, the obligation is terminal — no further transitions.

export type LifecycleStatus = "ACTIVE" | "WAIVED" | "CANCELLED";

export const LIFECYCLE_STATUSES: readonly LifecycleStatus[] = [
  "ACTIVE",
  "WAIVED",
  "CANCELLED",
] as const;

// ── Settlement Status ────────────────────────────────────────────────────────
// Represents how much of the obligation has been paid.
// Settlement transitions: UNPAID → PARTIAL → PAID
// Settlement is independent of lifecycle — a WAIVED obligation may have been PARTIAL.

export type SettlementStatus = "UNPAID" | "PARTIAL" | "PAID";

export const SETTLEMENT_STATUSES: readonly SettlementStatus[] = [
  "UNPAID",
  "PARTIAL",
  "PAID",
] as const;

// ── Presentation Status ──────────────────────────────────────────────────────
// Derived from lifecycle + settlement + due_date. NEVER persisted.

export type PresentationStatus =
  | "OVERDUE"    // ACTIVE + UNPAID/PARTIAL + due_date < now
  | "UPCOMING"   // ACTIVE + UNPAID + due_date > now
  | "PENDING"    // ACTIVE + UNPAID + due_date <= now (same day)
  | "PARTIAL"    // ACTIVE + PARTIAL
  | "PAID"       // ACTIVE + PAID (or any lifecycle + PAID)
  | "WAIVED"     // WAIVED lifecycle
  | "CANCELLED"; // CANCELLED lifecycle

/**
 * Derive the presentation status from the canonical two-column state.
 * This is the ONLY function that computes display status — no other logic
 * should duplicate this derivation.
 */
function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Derive the presentation status from the canonical two-column state.
 * This is the ONLY function that computes display status — no other logic
 * should duplicate this derivation.
 *
 * Uses UTC-midnight comparison, matching settlement-planner.ts::isPastDueDate
 * (due_date columns are always UTC-midnight-anchored business dates — see
 * agreement-rent-schedule-service.ts's firstOfUtcMonth/dueDateForMonth).
 * Comparing against a local-timezone "today" would shift the effective
 * calendar-day boundary by up to the server's UTC offset.
 */
export function derivePresentationStatus(
  lifecycle: LifecycleStatus,
  settlement: SettlementStatus,
  dueDate: Date,
  now: Date = new Date()
): PresentationStatus {
  if (lifecycle === "CANCELLED") return "CANCELLED";
  if (lifecycle === "WAIVED") return "WAIVED";

  // lifecycle === "ACTIVE"
  const dueDateStart = utcMidnight(dueDate);
  const nowStart = utcMidnight(now);

  if (settlement === "PAID") return "PAID";
  if (settlement === "PARTIAL") {
    return nowStart > dueDateStart ? "OVERDUE" : "PARTIAL";
  }

  // UNPAID
  if (nowStart > dueDateStart) return "OVERDUE";
  if (nowStart < dueDateStart) return "UPCOMING";
  return "PENDING"; // same day
}

// ── Legacy Status Mapping ────────────────────────────────────────────────────
// Used during the dual-write migration (Phase B).
// Maps new two-column state back to old single `status` column.

/**
 * Never returns OVERDUE or UPCOMING — those are presentation-only states
 * (see the module doc-comment above) and must never be persisted to
 * rent_obligations.status. ACTIVE + UNPAID always collapses to PENDING here,
 * regardless of due date. Callers that need the presentation-level
 * OVERDUE/UPCOMING distinction should use derivePresentationStatus / the
 * settlement-planner predicates (isOverdue/isRemindable) instead of this
 * function's dueDate parameter.
 */
export function toLegacyStatus(
  lifecycle: LifecycleStatus,
  settlement: SettlementStatus,
  dueDate: Date
): string {
  if (lifecycle === "CANCELLED") return "CANCELLED";
  if (lifecycle === "WAIVED") return "WAIVED";
  if (settlement === "PAID") return "PAID";
  if (settlement === "PARTIAL") return "PARTIAL";

  // ACTIVE + UNPAID → PENDING (never OVERDUE/UPCOMING — see doc-comment above).
  return "PENDING";
}

/**
 * Parse a legacy single status into the two-column model.
 * Used during backfill migration and to understand existing queries.
 */
export function fromLegacyStatus(status: string): {
  lifecycle_status: LifecycleStatus;
  settlement_status: SettlementStatus;
} {
  switch (status) {
    case "WAIVED":
      return { lifecycle_status: "WAIVED", settlement_status: "UNPAID" };
    case "CANCELLED":
      return { lifecycle_status: "CANCELLED", settlement_status: "UNPAID" };
    case "PAID":
      return { lifecycle_status: "ACTIVE", settlement_status: "PAID" };
    case "PARTIAL":
      return { lifecycle_status: "ACTIVE", settlement_status: "PARTIAL" };
    case "DRAFT":
      return { lifecycle_status: "ACTIVE", settlement_status: "UNPAID" };
    // PENDING, OVERDUE, UPCOMING all map to ACTIVE + UNPAID
    default:
      return { lifecycle_status: "ACTIVE", settlement_status: "UNPAID" };
  }
}

// ── Financial Obligation ─────────────────────────────────────────────────────
// The domain representation of a financial obligation.
// Maps to `rent_obligations` table but uses clean domain names.

export interface FinancialObligation {
  id: string;
  tenant_id: string;
  owner_id: string | null;
  hostel_id: string;
  allocation_id: string | null;
  agreement_id: string | null;

  // Type and description
  obligation_type: ObligationType | string;
  description: string | null;
  notes: string | null;

  // Amounts (rupees)
  amount: number;
  late_fee: number;
  total_amount: number;

  // Temporal
  due_date: Date;
  rent_month: Date | null;
  billing_period_start: Date | null;
  billing_period_end: Date | null;

  // Status (two-column model)
  lifecycle_status: LifecycleStatus;
  settlement_status: SettlementStatus;

  // Legacy (deprecated — dual-write only)
  status: string;

  // Billing plan
  installment_label: string | null;
  installment_sequence: number | null;
  billing_plan_id: string | null;

  // Lifecycle metadata
  created_at: Date;
  created_by: string | null;
  waived_at: Date | null;
  waived_reason: string | null;
  waived_by: string | null;
  waived_amount: number | null;
  cancelled_at: Date | null;
  cancelled_reason: string | null;
  cancelled_by: string | null;
}

// ── Financial Context ────────────────────────────────────────────────────────
// Unified context object for all financial operations.
// Instead of passing tenantId + hostelId + ownerId + ... everywhere,
// operations receive a single FinancialContext.

export interface FinancialContext {
  tenant: {
    id: string;
    owner_id: string;
    hostel_id: string;
    monthly_rent: number;
  };
  hostel: {
    id: string;
    owner_id: string;
  };
  actor: {
    id: string;
    role: string;
  };
  policy: import("./financial-policy").FinancialPolicy;
  /** Optional — populated when the operation is scoped to a specific owner beyond hostel/tenant.owner_id. */
  owner?: {
    id: string;
  };
  /** Optional — populated when the operation is settling/previewing against a known payment amount. */
  payment?: {
    amount: number;
    method?: string;
    referenceNumber?: string;
    paymentAttemptId?: string;
    allowedObligationIds?: string[];
  };
  /** Optional — populated when the caller has already loaded the obligation set (avoids a re-fetch). */
  obligations?: FinancialObligation[];
}

/**
 * Check if an obligation is payable (can receive payments).
 * Payable = ACTIVE lifecycle + not fully PAID settlement.
 */
export function isPayableObligation(o: {
  lifecycle_status?: LifecycleStatus;
  settlement_status?: SettlementStatus;
  status?: string;
}): boolean {
  // New two-column model
  if (o.lifecycle_status && o.settlement_status) {
    return o.lifecycle_status === "ACTIVE" && o.settlement_status !== "PAID";
  }
  // Legacy fallback
  const NON_PAYABLE = new Set(["PAID", "WAIVED", "CANCELLED", "DRAFT"]);
  return !NON_PAYABLE.has(String(o.status || ""));
}

/**
 * Check if an obligation lifecycle is terminal (no further transitions).
 */
export function isTerminalLifecycle(lifecycle: LifecycleStatus): boolean {
  return lifecycle === "WAIVED" || lifecycle === "CANCELLED";
}
