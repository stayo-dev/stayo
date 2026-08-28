import { describe, it, expect } from 'vitest';
import {
  planQuickExitSteps,
  detectSettlementDrift,
} from '@/lib/services/move-out-quick-exit-plan';

/**
 * Quick exit collapses five owner-visible checkpoints into one tap. These are
 * the two checks that had to become explicit as a result — see ADR-122.
 */

describe('planQuickExitSteps — resumability', () => {
  it('runs the whole pipeline for a fresh request', () => {
    expect(planQuickExitSteps('REQUESTED')).toEqual([
      'INSPECTED', 'SETTLED', 'VACATED', 'COMPLETED',
    ]);
  });

  it('skips the inspection when one is already on record', () => {
    expect(planQuickExitSteps('SETTLEMENT_PENDING')).toEqual([
      'SETTLED', 'VACATED', 'COMPLETED',
    ]);
  });

  it('skips settlement approval once it has been approved', () => {
    expect(planQuickExitSteps('SETTLEMENT_APPROVED')).toEqual(['VACATED', 'COMPLETED']);
  });

  it('only completes when the bed is already released', () => {
    expect(planQuickExitSteps('PHYSICALLY_VACATED')).toEqual(['COMPLETED']);
    expect(planQuickExitSteps('SETTLEMENT_PENDING_PAYMENT')).toEqual(['COMPLETED']);
  });

  /*
   * The whole point of resumability: a mid-way failure leaves a real request
   * at an earlier state, and tapping again must not re-apply what already
   * happened. Re-vacating would rewrite the exit date and re-fire the
   * notification; re-inspecting would overwrite the inspection row.
   */
  it('never repeats a step the request has already taken', () => {
    const order = ['INSPECTED', 'SETTLED', 'VACATED', 'COMPLETED'];
    const statuses = [
      'REQUESTED', 'SETTLEMENT_PENDING', 'SETTLEMENT_APPROVED', 'PHYSICALLY_VACATED',
    ];
    statuses.forEach((status, i) => {
      expect(planQuickExitSteps(status)).toEqual(order.slice(i));
    });
  });

  it('resumes a request written before the status rename', () => {
    // APPROVED/VACATED are the legacy spellings of SETTLEMENT_APPROVED and
    // PHYSICALLY_VACATED. Without canonicalisation these fall through to []
    // and the owner's tap silently does nothing.
    expect(planQuickExitSteps('APPROVED')).toEqual(['VACATED', 'COMPLETED']);
    expect(planQuickExitSteps('VACATED')).toEqual(['COMPLETED']);
  });

  it('does nothing for terminal or unrecognised statuses', () => {
    expect(planQuickExitSteps('COMPLETED')).toEqual([]);
    expect(planQuickExitSteps('REJECTED')).toEqual([]);
    expect(planQuickExitSteps('SOMETHING_NEW')).toEqual([]);
  });
});

describe('detectSettlementDrift — closing only what the owner saw', () => {
  const settled = { net_settlement_amount: 0, settlement_direction: 'SETTLED' };

  it('passes when the figures still match', () => {
    expect(detectSettlementDrift(settled, { net: 0, direction: 'SETTLED' }))
      .toEqual({ drifted: false });
  });

  it('catches a payment that landed while the owner was reading', () => {
    // Owner saw "tenant owes ₹25,000"; the tenant paid ₹25,000 in the
    // meantime, so the real outcome is now SETTLED.
    const actual = { net_settlement_amount: 0, settlement_direction: 'SETTLED' };
    expect(detectSettlementDrift(actual, { net: -25000, direction: 'TENANT_OWES_OWNER' }))
      .toEqual({ drifted: true, reason: 'DIRECTION' });
  });

  it('catches an amount change within the same direction', () => {
    const actual = { net_settlement_amount: -26500, settlement_direction: 'TENANT_OWES_OWNER' };
    expect(detectSettlementDrift(actual, { net: -25000, direction: 'TENANT_OWES_OWNER' }))
      .toEqual({ drifted: true, reason: 'AMOUNT' });
  });

  it('flags a rupee but tolerates float representation noise', () => {
    // The preview rounds to 2dp and survives a JSON round trip, so an exact
    // !== rejects on representation alone. One rupee is a real difference.
    const noisy = { net_settlement_amount: 5000.000000001, settlement_direction: 'OWNER_OWES_TENANT' };
    expect(detectSettlementDrift(noisy, { net: 5000, direction: 'OWNER_OWES_TENANT' }).drifted)
      .toBe(false);

    const realChange = { net_settlement_amount: 5001, settlement_direction: 'OWNER_OWES_TENANT' };
    expect(detectSettlementDrift(realChange, { net: 5000, direction: 'OWNER_OWES_TENANT' }).drifted)
      .toBe(true);
  });

  it('compares direction before amount, so a sign flip is never read as equal', () => {
    // -0 and 0 compare equal numerically; the direction is what distinguishes
    // "owner refunds nothing" from "tenant owes nothing".
    const actual = { net_settlement_amount: 0, settlement_direction: 'OWNER_OWES_TENANT' };
    expect(detectSettlementDrift(actual, { net: -0, direction: 'TENANT_OWES_OWNER' }))
      .toEqual({ drifted: true, reason: 'DIRECTION' });
  });
});
