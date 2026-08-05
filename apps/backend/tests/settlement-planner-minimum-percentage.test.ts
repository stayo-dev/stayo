import { describe, expect, it } from 'vitest';
import {
  buildSettlementPlan,
  type ObligationSnapshot,
  type PaymentPolicy,
} from '@/src/services/payments/settlement-planner';

/**
 * Percentage floor on partial payments (ADR-043).
 *
 * `minimum_amount` and `minimum_percentage` are both *floors*, so the stricter
 * one wins. Neither may ever exceed what the tenant actually owes.
 *
 * Pure — no database. Runs under `npm run test:pure`.
 */

function ob(id: string, amount: number, paid = 0): ObligationSnapshot {
  return {
    id,
    obligation_type: 'RENT',
    amount,
    paid,
    due_date: new Date('2026-06-05'),
    rent_month: new Date('2026-06-01'),
    owner_id: 'owner-1',
    status: 'PENDING',
  } as ObligationSnapshot;
}

const pct = (p: number, min = 0): PaymentPolicy => ({
  allow_partial: true,
  minimum_amount: min,
  minimum_percentage: p,
});

describe('Partial payment — percentage floor', () => {
  it('requires the configured percentage of total outstanding', () => {
    // 25% of ₹10,000 = ₹2,500
    const plan = buildSettlementPlan([ob('a', 10000)], 2500, pct(25));
    expect(plan.minimum_allowed).toBe(2500);
    expect(plan.payment_accepted).toBe(true);
  });

  it('rejects just below the percentage floor', () => {
    const plan = buildSettlementPlan([ob('a', 10000)], 2499, pct(25));
    expect(plan.payment_accepted).toBe(false);
    expect(plan.minimum_allowed).toBe(2500);
  });

  it('computes the percentage across ALL outstanding, not one obligation', () => {
    // 10% of (10000 + 6000) = 1600
    const plan = buildSettlementPlan([ob('a', 10000), ob('b', 6000)], 1600, pct(10));
    expect(plan.minimum_allowed).toBe(1600);
    expect(plan.payment_accepted).toBe(true);
  });

  it('accounts for amounts already paid when computing outstanding', () => {
    // outstanding = (10000-8000) = 2000; 50% = 1000
    const plan = buildSettlementPlan([ob('a', 10000, 8000)], 1000, pct(50));
    expect(plan.minimum_allowed).toBe(1000);
    expect(plan.payment_accepted).toBe(true);
  });

  it('takes the LARGER of the absolute and percentage floors — percentage wins', () => {
    // 30% of 10000 = 3000 vs absolute 1000 -> 3000
    const plan = buildSettlementPlan([ob('a', 10000)], 2000, pct(30, 1000));
    expect(plan.minimum_allowed).toBe(3000);
    expect(plan.payment_accepted).toBe(false);
  });

  it('takes the LARGER of the two — absolute wins', () => {
    // 5% of 10000 = 500 vs absolute 4000 -> 4000
    const plan = buildSettlementPlan([ob('a', 10000)], 3000, pct(5, 4000));
    expect(plan.minimum_allowed).toBe(4000);
    expect(plan.payment_accepted).toBe(false);
  });

  it('never demands more than is actually owed', () => {
    // A ₹5,000 absolute floor must not make a ₹500 remaining balance unpayable.
    const plan = buildSettlementPlan([ob('a', 10000, 9500)], 500, pct(0, 5000));
    expect(plan.minimum_allowed).toBe(500);
    expect(plan.payment_accepted).toBe(true);
  });

  it('scales the percentage floor down with the remaining balance', () => {
    // Outstanding is ₹100, so an 80% floor is ₹80 — not ₹80 of the original
    // ₹10,000. The percentage can never exceed the balance on its own, since
    // validation caps it at 100%; only `minimum_amount` needs the clamp.
    const plan = buildSettlementPlan([ob('a', 10000, 9900)], 80, pct(80));
    expect(plan.minimum_allowed).toBe(80);
    expect(plan.payment_accepted).toBe(true);
  });

  it('rounds the percentage floor up, never down', () => {
    // 33% of 1000 = 330 exactly; 33% of 1001 = 330.33 -> 331
    expect(buildSettlementPlan([ob('a', 1001)], 331, pct(33)).minimum_allowed).toBe(331);
  });

  it('0% means no percentage floor', () => {
    const plan = buildSettlementPlan([ob('a', 10000)], 1, pct(0));
    expect(plan.minimum_allowed).toBe(1);
    expect(plan.payment_accepted).toBe(true);
  });

  it('100% effectively requires clearing the whole balance', () => {
    const all = buildSettlementPlan([ob('a', 10000)], 10000, pct(100));
    expect(all.minimum_allowed).toBe(10000);
    expect(all.payment_accepted).toBe(true);

    const short = buildSettlementPlan([ob('a', 10000)], 9999, pct(100));
    expect(short.payment_accepted).toBe(false);
  });

  it('is ignored entirely when partial payments are off', () => {
    const plan = buildSettlementPlan([ob('a', 10000)], 2500, {
      allow_partial: false,
      minimum_amount: 0,
      minimum_percentage: 25,
    });
    // Full-payment policy still demands the whole first tier, not 25%.
    expect(plan.minimum_allowed).toBe(10000);
    expect(plan.payment_accepted).toBe(false);
  });

  it('treats an absent minimum_percentage as 0 (back-compat)', () => {
    const plan = buildSettlementPlan([ob('a', 10000)], 1, {
      allow_partial: true,
      minimum_amount: 0,
    });
    expect(plan.minimum_allowed).toBe(1);
    expect(plan.payment_accepted).toBe(true);
  });

  it('echoes the configured floors back for the UI to explain', () => {
    const plan = buildSettlementPlan([ob('a', 10000)], 5000, pct(25, 1000));
    expect(plan.policy_minimum_percentage).toBe(25);
    expect(plan.policy_minimum_amount).toBe(1000);
    expect(plan.payment_policy).toBe('PARTIAL_ALLOWED');
  });

  it('names the percentage rule in the rejection reason when it drives the floor', () => {
    const plan = buildSettlementPlan([ob('a', 10000)], 100, pct(25, 1000));
    expect(plan.rejection_reason).toContain('25%');
    expect(plan.rejection_reason).toContain('2,500');
  });

  it('does not mention a percentage when the absolute floor drives it', () => {
    const plan = buildSettlementPlan([ob('a', 10000)], 100, pct(5, 4000));
    expect(plan.rejection_reason).not.toContain('%');
    expect(plan.rejection_reason).toContain('4,000');
  });
});
