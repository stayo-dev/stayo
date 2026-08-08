import { describe, expect, it } from 'vitest';
import { buildBillingPatch, type BillingFormValues, type BillingSectionKey } from './billingSections';

/**
 * Splitting the one billing screen into focused per-section screens
 * reintroduces the exact hazard ADR-043 consolidated it to fix: three screens
 * each owning a slice of `billing`, overwriting one another. The old
 * `MoreBillingPage` silently rewrote a PERCENTAGE/PER_DAY late fee to FLAT and
 * dropped its cap, because it always wrote a partial late-fee shape.
 *
 * The safeguard is here: a patch contains **only** the fields the visible
 * sections own. The backend deep-merges, so an omitted section is left exactly
 * as it was — a focused screen cannot clobber what it does not display.
 */
const values: BillingFormValues = {
  allowPartial: true,
  minAmount: 500,
  minPercentage: 25,
  depositMonths: 2,
  agreementMonths: 11,
  generationDay: 1,
  dueDay: 5,
  graceDays: 3,
  lateFeeEnabled: true,
  chargeType: 'PER_DAY',
  lateFeeAmount: 50,
  maxLateFee: 2000,
};

const patchFor = (...sections: BillingSectionKey[]) => buildBillingPatch(values, sections);

describe('buildBillingPatch — section isolation', () => {
  it('writes only the schedule fields for the schedule section', () => {
    expect(patchFor('schedule')).toEqual({
      billing: { auto_rent_day: 1, due_day: 5, grace_days: 3 },
    });
  });

  it('writes only the deposit field for the deposit section', () => {
    expect(patchFor('deposit')).toEqual({ billing: { deposit: { deposit_months: 2 } } });
  });

  it('writes only the agreement duration for the agreement section', () => {
    expect(patchFor('agreement')).toEqual({
      billing: { invite_defaults: { agreement_duration_months: 11 } },
    });
  });

  it('writes only part-payment fields for the collection section', () => {
    expect(patchFor('collection')).toEqual({
      billing: {
        partial_payments: { enabled: true, minimum_amount: 500, minimum_percentage: 25 },
      },
    });
  });

  it('never lets one section touch another section’s fields', () => {
    const schedule = patchFor('schedule').billing as Record<string, unknown>;

    // The bug ADR-043 fixed, expressed as a test: editing the schedule must not
    // mention the late fee, the deposit, or part payments at all.
    expect(schedule).not.toHaveProperty('late_fee');
    expect(schedule).not.toHaveProperty('deposit');
    expect(schedule).not.toHaveProperty('partial_payments');
    expect(schedule).not.toHaveProperty('invite_defaults');
  });
});

describe('buildBillingPatch — late fee is always written whole', () => {
  it('includes type, amount and cap together, never a partial shape', () => {
    const lateFee = (patchFor('lateFee').billing as any).late_fee;

    expect(lateFee).toEqual({
      enabled: true,
      rules: [{ type: 'PER_DAY', amount: 50, starts_after_days: 3 }],
      max_amount: 2000,
    });
  });

  it('carries the grace period into starts_after_days even when the schedule section is hidden', () => {
    // The late-fee rule depends on grace days, which live in another section.
    // Omitting it would reset when a late fee starts applying.
    const lateFee = (patchFor('lateFee').billing as any).late_fee;

    expect(lateFee.rules[0].starts_after_days).toBe(3);
  });

  it('collapses to a disabled flag when switched off, without inventing a rule', () => {
    const off = buildBillingPatch({ ...values, lateFeeEnabled: false }, ['lateFee']);

    expect((off.billing as any).late_fee).toEqual({ enabled: false });
  });
});

describe('buildBillingPatch — combined use', () => {
  it('still supports every section at once, for the all-settings screen', () => {
    const all = buildBillingPatch(values, ['collection', 'deposit', 'agreement', 'schedule', 'lateFee']);
    const billing = all.billing as Record<string, unknown>;

    expect(Object.keys(billing).sort()).toEqual(
      ['auto_rent_day', 'deposit', 'due_day', 'grace_days', 'invite_defaults', 'late_fee', 'partial_payments'].sort(),
    );
  });

  it('produces an empty billing patch when no sections are shown', () => {
    expect(buildBillingPatch(values, [])).toEqual({ billing: {} });
  });
});
