import { describe, expect, it } from 'vitest';
import {
  buildSettlementPlan,
  type ObligationSnapshot,
  type PaymentPolicy,
} from '@/src/services/payments/settlement-planner';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeObligation(overrides: Partial<ObligationSnapshot> & { id: string }): ObligationSnapshot {
  return {
    obligation_type: 'RENT',
    amount: 10000,
    paid: 0,
    due_date: new Date('2026-06-05'),
    rent_month: new Date('2026-06-01'),
    owner_id: 'owner-1',
    ...overrides,
  };
}

const MANDATORY: PaymentPolicy = { allow_partial: false, minimum_amount: 0 };
const PARTIAL: PaymentPolicy = { allow_partial: true, minimum_amount: 0 };
const PARTIAL_1K: PaymentPolicy = { allow_partial: true, minimum_amount: 1000 };

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Settlement Planner — Payment Policy Validation', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // MANDATORY POLICY (allow_partial = false)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Mandatory Full Payment Policy', () => {
    it('should accept full payment of a single obligation', () => {
      const obs = [makeObligation({ id: 'ob1', amount: 10000, paid: 0 })];
      const plan = buildSettlementPlan(obs, 10000, MANDATORY);

      expect(plan.payment_accepted).toBe(true);
      expect(plan.rejection_reason).toBeNull();
      expect(plan.payment_policy).toBe('FULL_PAYMENT');
      expect(plan.allocations[0].result).toBe('PAID');
    });

    it('should reject partial payment below tier minimum', () => {
      const obs = [makeObligation({ id: 'ob1', amount: 10000, paid: 0 })];
      const plan = buildSettlementPlan(obs, 5000, MANDATORY);

      expect(plan.payment_accepted).toBe(false);
      // Owner-language wording (ADR-043) — states the policy, not the flag.
      expect(plan.rejection_reason).toContain("doesn't accept part payments");
      expect(plan.minimum_allowed).toBe(10000);
    });

    it('should accept exact tier amount with multiple obligations in same tier', () => {
      const obs = [
        makeObligation({ id: 'ob1', obligation_type: 'RENT', amount: 8000, paid: 0, due_date: new Date('2026-06-05'), rent_month: new Date('2026-06-01') }),
        makeObligation({ id: 'ob2', obligation_type: 'RENT', amount: 8000, paid: 0, due_date: new Date('2026-07-05'), rent_month: new Date('2026-07-01') }),
      ];
      // Minimum = sum of all RENT tier = 16000
      const plan = buildSettlementPlan(obs, 16000, MANDATORY);

      expect(plan.payment_accepted).toBe(true);
      expect(plan.total_to_settle).toBe(16000);
    });

    it('should use tier-based minimum for mixed obligation types', () => {
      // Onboarding tier: Security Deposit ₹5000 + Maintenance ₹2000 = ₹7000 minimum
      const obs = [
        makeObligation({ id: 'ob1', obligation_type: 'SECURITY_DEPOSIT', amount: 5000, paid: 0 }),
        makeObligation({ id: 'ob2', obligation_type: 'MAINTENANCE', amount: 2000, paid: 0 }),
        makeObligation({ id: 'ob3', obligation_type: 'RENT', amount: 10000, paid: 0 }),
      ];

      // ₹5000 < ₹7000 (ONBOARDING tier total) → rejected
      const planLow = buildSettlementPlan(obs, 5000, MANDATORY);
      expect(planLow.payment_accepted).toBe(false);
      expect(planLow.minimum_allowed).toBe(7000);
      expect(planLow.first_tier_label).toBe('Onboarding Dues');

      // ₹7000 = ONBOARDING tier total → accepted
      const planExact = buildSettlementPlan(obs, 7000, MANDATORY);
      expect(planExact.payment_accepted).toBe(true);
    });

    it('should accept payment that clears remaining balance on partially paid obligation', () => {
      const obs = [makeObligation({ id: 'ob1', amount: 10000, paid: 6000 })];
      // Outstanding = 4000, minimum = 4000 (remaining rent tier)
      const plan = buildSettlementPlan(obs, 4000, MANDATORY);

      expect(plan.payment_accepted).toBe(true);
      expect(plan.allocations[0].result).toBe('PAID');
    });

    it('should reject payment below remaining balance on partially paid obligation', () => {
      const obs = [makeObligation({ id: 'ob1', amount: 10000, paid: 6000 })];
      // Outstanding = 4000, trying to pay 2000
      const plan = buildSettlementPlan(obs, 2000, MANDATORY);

      expect(plan.payment_accepted).toBe(false);
      expect(plan.minimum_allowed).toBe(4000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PARTIAL PAYMENT POLICY (allow_partial = true)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Partial Payment Policy', () => {
    it('should accept any positive amount when no minimum configured', () => {
      const obs = [makeObligation({ id: 'ob1', amount: 10000, paid: 0 })];
      const plan = buildSettlementPlan(obs, 1, PARTIAL);

      expect(plan.payment_accepted).toBe(true);
      expect(plan.payment_policy).toBe('PARTIAL_ALLOWED');
    });

    it('should accept amount exactly at minimum threshold', () => {
      const obs = [makeObligation({ id: 'ob1', amount: 10000, paid: 0 })];
      const plan = buildSettlementPlan(obs, 1000, PARTIAL_1K);

      expect(plan.payment_accepted).toBe(true);
    });

    it('should reject amount below minimum threshold', () => {
      const obs = [makeObligation({ id: 'ob1', amount: 10000, paid: 0 })];
      const plan = buildSettlementPlan(obs, 500, PARTIAL_1K);

      expect(plan.payment_accepted).toBe(false);
      // Owner-language wording (ADR-043).
      expect(plan.rejection_reason).toContain('accepts part payments of \u20b91,000 or more');
      expect(plan.minimum_allowed).toBe(1000);
    });

    it('should correctly allocate partial payment to first obligation only', () => {
      const obs = [
        makeObligation({ id: 'ob1', amount: 10000, paid: 0, due_date: new Date('2026-06-05') }),
        makeObligation({ id: 'ob2', amount: 10000, paid: 0, due_date: new Date('2026-07-05') }),
      ];
      const plan = buildSettlementPlan(obs, 3000, PARTIAL);

      expect(plan.payment_accepted).toBe(true);
      expect(plan.allocations[0].allocated).toBe(3000);
      expect(plan.allocations[0].result).toBe('PARTIAL');
      expect(plan.allocations[1].allocated).toBe(0);
      expect(plan.allocations[1].result).toBe('UNCHANGED');
    });

    it('should handle sequential partial payments correctly', () => {
      // First partial: 6000 already paid, paying 2000 more
      const obs = [makeObligation({ id: 'ob1', amount: 10000, paid: 6000 })];
      const plan = buildSettlementPlan(obs, 2000, PARTIAL);

      expect(plan.payment_accepted).toBe(true);
      expect(plan.allocations[0].allocated).toBe(2000);
      expect(plan.allocations[0].result).toBe('PARTIAL');
      expect(plan.remaining_outstanding).toBe(2000);
    });

    it('should mark obligation as PAID when partial payment clears remaining', () => {
      const obs = [makeObligation({ id: 'ob1', amount: 10000, paid: 6000 })];
      const plan = buildSettlementPlan(obs, 4000, PARTIAL);

      expect(plan.payment_accepted).toBe(true);
      expect(plan.allocations[0].result).toBe('PAID');
      expect(plan.remaining_outstanding).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EDGE CASES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Edge Cases', () => {
    it('reports the full amount as unallocated when nothing is outstanding', () => {
      // All obligations fully paid
      const obs = [makeObligation({ id: 'ob1', amount: 10000, paid: 10000 })];
      const plan = buildSettlementPlan(obs, 5000, MANDATORY);

      expect(plan.payment_accepted).toBe(true);
      expect(plan.unallocated).toBe(5000);
      expect(plan.warnings).toContain(
        '₹5,000 exceeds every settleable installment and cannot be accepted',
      );
    });

    it('should handle payment exceeding total outstanding gracefully', () => {
      const obs = [makeObligation({ id: 'ob1', amount: 10000, paid: 0 })];
      const plan = buildSettlementPlan(obs, 15000, PARTIAL);

      expect(plan.payment_accepted).toBe(true);
      expect(plan.allocations[0].result).toBe('PAID');
      expect(plan.unallocated).toBe(5000);
      expect(plan.total_to_settle).toBe(10000);
    });

    it('should follow settlement priority across obligation types', () => {
      const obs = [
        makeObligation({ id: 'ob1', obligation_type: 'RENT', amount: 10000, paid: 0 }),
        makeObligation({ id: 'ob2', obligation_type: 'SECURITY_DEPOSIT', amount: 5000, paid: 0 }),
        makeObligation({ id: 'ob3', obligation_type: 'LATE_FEE', amount: 500, paid: 0 }),
      ];
      // Security Deposit should be settled first (priority 1)
      const plan = buildSettlementPlan(obs, 5000, PARTIAL);

      expect(plan.allocations[0].type).toBe('SECURITY_DEPOSIT');
      expect(plan.allocations[0].allocated).toBe(5000);
      expect(plan.allocations[0].result).toBe('PAID');
    });

    it('should compute correct minimum for empty obligation list', () => {
      const plan = buildSettlementPlan([], 100, MANDATORY);

      expect(plan.payment_accepted).toBe(true);
      expect(plan.unallocated).toBe(100);
      expect(plan.minimum_allowed).toBe(1);
    });

    it('should compute correct minimum with minimum_amount policy on partial', () => {
      const obs = [makeObligation({ id: 'ob1', amount: 10000, paid: 0 })];
      const policy: PaymentPolicy = { allow_partial: true, minimum_amount: 2500 };

      const planBelow = buildSettlementPlan(obs, 2000, policy);
      expect(planBelow.payment_accepted).toBe(false);
      expect(planBelow.minimum_allowed).toBe(2500);

      const planAbove = buildSettlementPlan(obs, 3000, policy);
      expect(planAbove.payment_accepted).toBe(true);
    });

    it('should handle mixed types with partial payments and minimum', () => {
      const obs = [
        makeObligation({ id: 'ob1', obligation_type: 'MAINTENANCE', amount: 2000, paid: 0 }),
        makeObligation({ id: 'ob2', obligation_type: 'RENT', amount: 8000, paid: 3000 }),
        makeObligation({ id: 'ob3', obligation_type: 'LATE_FEE', amount: 500, paid: 0 }),
      ];
      // Total outstanding = 2000 + 5000 + 500 = 7500
      // Partial with ₹1000 minimum
      const plan = buildSettlementPlan(obs, 1500, PARTIAL_1K);

      expect(plan.payment_accepted).toBe(true);
      // Should allocate to MAINTENANCE first (priority 3 — ONBOARDING tier)
      expect(plan.allocations[0].type).toBe('MAINTENANCE');
      expect(plan.allocations[0].allocated).toBe(1500);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SETTLEMENT PLAN OUTPUT CORRECTNESS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Settlement Plan Output', () => {
    it('should compute summary correctly for full settlement', () => {
      const obs = [
        makeObligation({ id: 'ob1', amount: 5000, paid: 0 }),
        makeObligation({ id: 'ob2', amount: 3000, paid: 0, due_date: new Date('2026-07-05') }),
      ];
      const plan = buildSettlementPlan(obs, 8000, PARTIAL);

      expect(plan.total_outstanding).toBe(8000);
      expect(plan.total_to_settle).toBe(8000);
      expect(plan.remaining_outstanding).toBe(0);
      expect(plan.unallocated).toBe(0);
      expect(plan.summary).toContain('2 obligation(s) settled');
    });

    it('reports the leftover as unallocated in the summary', () => {
      const obs = [makeObligation({ id: 'ob1', amount: 5000, paid: 0 })];
      const plan = buildSettlementPlan(obs, 7000, PARTIAL);

      expect(plan.total_to_settle).toBe(5000);
      expect(plan.unallocated).toBe(2000);
      expect(plan.summary).toContain('unallocated');
      expect(plan.summary).not.toContain('future credit');
    });

    it('should preserve integer math (no floating point errors)', () => {
      const obs = [makeObligation({ id: 'ob1', amount: 10000.50, paid: 3333.17 })];
      const plan = buildSettlementPlan(obs, 6667.33, PARTIAL);

      // Outstanding = 10000.50 - 3333.17 = 6667.33 (exact)
      expect(plan.payment_accepted).toBe(true);
      expect(plan.allocations[0].result).toBe('PAID');
      // No floating point residual
      expect(plan.unallocated).toBe(0);
    });
  });
});
