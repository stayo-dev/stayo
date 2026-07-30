/**
 * 💰 Financial Policy — Settlement Rule Isolation
 *
 * Extracts settlement-specific rules from the monolithic HostelPolicy
 * into a focused, testable interface that the Settlement Planner consumes.
 *
 * The HostelPolicy has 10+ domains (billing, reminders, receipts, etc.).
 * The FinancialPolicy contains ONLY the rules that affect payment allocation:
 *   - Partial payment rules
 *   - Settlement priority (future: customizable per hostel)
 *   - Grace periods and late fee thresholds
 *   - Overflow strategy (future credit vs reject)
 *   - Deposit exemptions (future: scholarship, employer-sponsored)
 *
 * This is the seam where future rules (scholarships, grace periods,
 * rent holidays, employer-sponsored payments) plug in — without
 * changing the Planner or Engine.
 */

import type { HostelPolicy } from "@/lib/services/hostel-policy-service";

// ── Financial Policy Interface ───────────────────────────────────────────────

export interface FinancialPolicy {
  /** Whether partial payments are allowed */
  partial_payments: {
    enabled: boolean;
    minimum_amount: number;
  };

  /** How excess payments are handled */
  overflow: {
    enabled: boolean;
    strategy: "CARRY_FORWARD" | "REJECT" | string;
  };

  /** Grace period before late fees apply */
  grace: {
    days: number;
  };

  /** Settlement priority customization (future: per-hostel overrides) */
  settlement: {
    /** Use the canonical SETTLEMENT_PRIORITY constant */
    use_canonical_priority: boolean;
    /** Future: custom priority overrides per obligation type */
    priority_overrides?: Record<string, number>;
  };

  /** Deposit-specific rules */
  deposit: {
    enabled: boolean;
    refundable: boolean;
  };

  /** Future extension points — no-ops today */
  extensions: {
    /** Scholarships that reduce obligation amounts */
    scholarships_enabled: boolean;
    /** Employer-sponsored payment routing */
    employer_payments_enabled: boolean;
    /** Rent holidays (e.g., vacation months) */
    rent_holidays_enabled: boolean;
  };
}

// ── Policy Loader ────────────────────────────────────────────────────────────

/**
 * Extract a FinancialPolicy from a HostelPolicy.
 *
 * This is the ONLY function that bridges HostelPolicy → FinancialPolicy.
 * The Settlement Planner should NEVER read HostelPolicy directly.
 */
export function extractFinancialPolicy(hostelPolicy: HostelPolicy): FinancialPolicy {
  return {
    partial_payments: {
      enabled: hostelPolicy.billing.partial_payments.enabled,
      minimum_amount: hostelPolicy.billing.partial_payments.minimum_amount,
    },
    overflow: {
      enabled: hostelPolicy.billing.overflow.enabled,
      strategy: hostelPolicy.billing.overflow.strategy,
    },
    grace: {
      days: hostelPolicy.billing.grace_days,
    },
    settlement: {
      use_canonical_priority: true,
      // Future: load from hostelPolicy.billing.settlement_priority_overrides
    },
    deposit: {
      enabled: hostelPolicy.billing.deposit.enabled,
      refundable: hostelPolicy.billing.deposit.refundable,
    },
    extensions: {
      scholarships_enabled: false,
      employer_payments_enabled: false,
      rent_holidays_enabled: false,
    },
  };
}

/**
 * Convert a FinancialPolicy into the PaymentPolicy shape
 * that the current Settlement Planner expects.
 *
 * This adapter exists during the transition period.
 * Eventually the Planner will consume FinancialPolicy directly.
 */
export function toPaymentPolicy(fp: FinancialPolicy): {
  allow_partial: boolean;
  minimum_amount: number;
} {
  return {
    allow_partial: fp.partial_payments.enabled,
    minimum_amount: fp.partial_payments.minimum_amount,
  };
}
