import { describe, expect, it } from 'vitest';
import {
  buildBillingPatch,
  policyToFormValues,
  type BillingFormValues,
  type BillingSectionKey,
} from './billingSections';
import { hasChanges } from '../config/dirtyState';

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
  depositEnabled: true,
  depositMode: 'MONTHS_OF_RENT',
  depositAmount: 10000,
  depositRefundable: true,
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

  it('writes only the deposit fields for the deposit section', () => {
    expect(patchFor('deposit')).toEqual({
      billing: {
        deposit: {
          enabled: true,
          calculation_mode: 'MONTHS_OF_RENT',
          deposit_months: 2,
          refundable: true,
        },
      },
    });
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

describe('buildBillingPatch — deposit calculation mode', () => {
  const depositFor = (overrides: Partial<BillingFormValues>) =>
    (buildBillingPatch({ ...values, ...overrides }, ['deposit']).billing as any).deposit;

  it('stores the mode, so "2 months" is actually applied as months of rent', () => {
    // Before this, the screen wrote deposit_months alone while the stored mode
    // stayed FLAT — so setting "2 months" changed nothing about what a tenant
    // was asked to pay.
    expect(depositFor({ depositMode: 'MONTHS_OF_RENT' }).calculation_mode).toBe('MONTHS_OF_RENT');
  });

  it('writes the fixed amount, not months, in flat mode', () => {
    const deposit = depositFor({ depositMode: 'FLAT' });

    expect(deposit).toEqual({
      enabled: true,
      calculation_mode: 'FLAT',
      default_amount: 10000,
      refundable: true,
    });
    // Omitted rather than zeroed, so flipping back to months keeps the setting.
    expect(deposit).not.toHaveProperty('deposit_months');
  });

  it('omits the flat amount in months mode, so it survives a mode flip', () => {
    expect(depositFor({ depositMode: 'MONTHS_OF_RENT' })).not.toHaveProperty('default_amount');
  });

  it('expresses "off" as a flat ₹0, because invite resolution ignores `enabled`', () => {
    // resolveTenantInviteDefaults computes MONTHS_OF_RENT -> months × rent
    // regardless of `enabled`. Leaving the mode stored while switching off would
    // keep collecting a deposit the owner believes they turned off.
    const deposit = depositFor({ depositEnabled: false, depositMode: 'MONTHS_OF_RENT' });

    expect(deposit).toEqual({
      enabled: false,
      calculation_mode: 'FLAT',
      default_amount: 0,
      refundable: true,
    });
  });

  it('carries the refundable flag in every mode, since move-out settlement reads it', () => {
    for (const mode of ['FLAT', 'MONTHS_OF_RENT'] as const) {
      expect(depositFor({ depositMode: mode, depositRefundable: false }).refundable).toBe(false);
    }
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

describe('policyToFormValues', () => {
  const storedPolicy = {
    auto_rent_day: 2,
    due_day: 7,
    grace_days: 3,
    partial_payments: { enabled: true, minimum_amount: 500, minimum_percentage: 25 },
    deposit: {
      enabled: true,
      calculation_mode: 'MONTHS_OF_RENT',
      deposit_months: 2,
      default_amount: 10000,
      refundable: false,
    },
    invite_defaults: { agreement_duration_months: 11 },
    late_fee: { enabled: true, rules: [{ type: 'PER_DAY', amount: 50 }], max_amount: 2000 },
  };

  it('reads a stored policy into form values', () => {
    const loaded = policyToFormValues(storedPolicy);

    expect(loaded.depositMode).toBe('MONTHS_OF_RENT');
    expect(loaded.depositMonths).toBe(2);
    expect(loaded.depositAmount).toBe(10000);
    expect(loaded.depositRefundable).toBe(false);
    expect(loaded.generationDay).toBe(2);
    expect(loaded.chargeType).toBe('PER_DAY');
  });

  it('leaves a freshly loaded screen clean, so Save stays hidden', () => {
    // The property the Save button depends on: baseline and initial state are
    // both derived here, so loading a policy can never look like an edit.
    const loaded = policyToFormValues(storedPolicy);

    expect(hasChanges(loaded, policyToFormValues(storedPolicy))).toBe(false);
  });

  it('reports dirty after a single change, and clean again when reverted', () => {
    const baseline = policyToFormValues(storedPolicy);

    expect(hasChanges(baseline, { ...baseline, depositMonths: 3 })).toBe(true);
    expect(hasChanges(baseline, { ...baseline, depositMonths: 2 })).toBe(false);
  });

  it('survives a round-trip through the patch builder without drifting', () => {
    const loaded = policyToFormValues(storedPolicy);
    const patch = buildBillingPatch(loaded, ['deposit']) as any;

    expect(policyToFormValues({ ...storedPolicy, deposit: { ...storedPolicy.deposit, ...patch.billing.deposit } }))
      .toEqual(loaded);
  });

  it('treats an unknown calculation mode as FLAT, matching the backend', () => {
    expect(policyToFormValues({ deposit: { calculation_mode: 'WEIRD' } }).depositMode).toBe('FLAT');
    expect(policyToFormValues({ deposit: {} }).depositMode).toBe('FLAT');
  });

  it('defaults an absent refundable flag to refundable', () => {
    expect(policyToFormValues({ deposit: { enabled: true } }).depositRefundable).toBe(true);
  });

  it('falls back to backend defaults for an empty policy', () => {
    const empty = policyToFormValues({});

    expect(empty.generationDay).toBe(1);
    expect(empty.dueDay).toBe(5);
    expect(empty.graceDays).toBe(0);
    expect(empty.depositMonths).toBe(1);
    expect(empty.agreementMonths).toBe(12);
    expect(empty.depositEnabled).toBe(false);
  });

  it('does not crash on a missing billing object', () => {
    expect(() => policyToFormValues(undefined)).not.toThrow();
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
