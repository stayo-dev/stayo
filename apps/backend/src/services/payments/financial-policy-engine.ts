/**
 * 🧭 Financial Policy Engine
 *
 * Single entry point for resolving hostel billing settings into the policy
 * shapes consumed by the Settlement Planner and the Financial Payment Facade.
 *
 * This does not introduce new rules — it composes the existing pure functions
 * in `financial-policy.ts` (`extractFinancialPolicy`, `toPaymentPolicy`) so
 * every call site stops repeating `normalizeHostelPolicy(hostel) -> { allow_partial, minimum_amount }`
 * inline. The Planner still only receives the narrow `PaymentPolicy` shape —
 * this engine is the seam where future rule sources plug in without touching
 * the Planner or Engine.
 */

import { normalizeHostelPolicy } from "@/lib/services/hostel-policy-service";
import { extractFinancialPolicy, toPaymentPolicy, type FinancialPolicy } from "./financial-policy";
import type { PaymentPolicy } from "./settlement-planner";

export class FinancialPolicyEngine {
  /**
   * Resolve the full FinancialPolicy from a raw hostel record
   * (as returned by `prisma.hostels.findUnique({ select: { preferences_config: true } })`).
   */
  resolveFinancialPolicy(hostelRecord: any): FinancialPolicy {
    return extractFinancialPolicy(normalizeHostelPolicy(hostelRecord));
  }

  /**
   * Resolve directly to the narrow PaymentPolicy shape the Settlement Planner
   * consumes. Replaces the repeated
   *   normalizeHostelPolicy(hostel) -> { allow_partial: ..., minimum_amount: ... }
   * block across create-intent / settlement-preview / settlement-plan / the facade.
   */
  resolvePaymentPolicy(hostelRecord: any): PaymentPolicy {
    return toPaymentPolicy(this.resolveFinancialPolicy(hostelRecord));
  }
}

export const financialPolicyEngine = new FinancialPolicyEngine();
