import { describe, expect, it } from 'vitest';
import { EMPTY_INVITE_WIZARD_DATA, type InviteWizardData } from '../types';
import {
  buildPreviewDisplay,
  buildPreviewRequestBody,
  describePreviewBlockers,
  isPaymentDetailsValid,
  isPreviewRequestReady,
  previewBlockers,
  previewRequestKey,
  isPaidAmountRecordable,
  paidOnError,
  type InviteSettlementPreviewResponse,
  type SettlementAllocationLite,
} from './settlementPreview';

function baseData(overrides: Partial<InviteWizardData> = {}): InviteWizardData {
  return {
    ...EMPTY_INVITE_WIZARD_DATA,
    hostelId: 'hostel-1',
    roomId: 'room-1',
    joiningDate: '2026-08-01',
    agreementMonths: '11',
    monthlyRent: '8000',
    deposit: '16000',
    ...overrides,
  };
}

describe('isPreviewRequestReady', () => {
  it('is false when the toggle is off, regardless of amount', () => {
    expect(isPreviewRequestReady(baseData({ hasPaidAlready: false, paidAmount: '40000' }))).toBe(false);
  });

  it('is false when the toggle is on but no amount was entered yet', () => {
    expect(isPreviewRequestReady(baseData({ hasPaidAlready: true, paidAmount: '' }))).toBe(false);
    expect(isPreviewRequestReady(baseData({ hasPaidAlready: true, paidAmount: '0' }))).toBe(false);
  });

  it('is false without a hostel, a joining date, or a duration', () => {
    expect(isPreviewRequestReady(baseData({ hasPaidAlready: true, paidAmount: '40000', hostelId: '' }))).toBe(false);
    expect(isPreviewRequestReady(baseData({ hasPaidAlready: true, paidAmount: '40000', joiningDate: '' }))).toBe(false);
    expect(isPreviewRequestReady(baseData({ hasPaidAlready: true, paidAmount: '40000', joiningDate: 'not-a-date' }))).toBe(false);
    expect(isPreviewRequestReady(baseData({ hasPaidAlready: true, paidAmount: '40000', agreementMonths: '0' }))).toBe(false);
  });

  it('is true once the toggle is on, a positive amount is entered, and the base terms are set', () => {
    expect(isPreviewRequestReady(baseData({ hasPaidAlready: true, paidAmount: '40000' }))).toBe(true);
  });

  it('is true for a start date five months in the past — case 2, the adopted hostel', () => {
    expect(
      isPreviewRequestReady(baseData({ hasPaidAlready: true, paidAmount: '48000', joiningDate: '2026-03-01' })),
    ).toBe(true);
  });
});

describe('buildPreviewRequestBody', () => {
  it('returns null when not ready', () => {
    expect(buildPreviewRequestBody(baseData({ hasPaidAlready: false }))).toBeNull();
  });

  it('maps wizard fields to the exact request shape, coercing blanks to 0', () => {
    const body = buildPreviewRequestBody(
      baseData({ hasPaidAlready: true, paidAmount: '40000', paidIncludesDeposit: false, maintenance: '' }),
    );
    expect(body).toEqual({
      hostel_id: 'hostel-1',
      monthly_rent: 8000,
      security_deposit: 16000,
      maintenance_charge: 0,
      agreement_start_date: '2026-08-01',
      agreement_duration_months: 11,
      amount_paid: 40000,
      amount_includes_deposit: false,
    });
  });

  it('defaults amount_includes_deposit to true, matching the form default', () => {
    const body = buildPreviewRequestBody(baseData({ hasPaidAlready: true, paidAmount: '40000' }));
    expect(body?.amount_includes_deposit).toBe(true);
  });
});

describe('previewRequestKey', () => {
  it('differs when any field differs', () => {
    const a = buildPreviewRequestBody(baseData({ hasPaidAlready: true, paidAmount: '40000' }))!;
    const b = buildPreviewRequestBody(baseData({ hasPaidAlready: true, paidAmount: '41000' }))!;
    expect(previewRequestKey(a)).not.toBe(previewRequestKey(b));
  });

  it('is stable for identical bodies', () => {
    const a = buildPreviewRequestBody(baseData({ hasPaidAlready: true, paidAmount: '40000' }))!;
    const b = buildPreviewRequestBody(baseData({ hasPaidAlready: true, paidAmount: '40000' }))!;
    expect(previewRequestKey(a)).toBe(previewRequestKey(b));
  });
});

describe('isPaymentDetailsValid', () => {
  it('is valid when nothing was paid, toggle off', () => {
    expect(isPaymentDetailsValid(baseData({ hasPaidAlready: false }))).toBe(true);
  });

  it('is valid when the toggle is on but the amount is still blank', () => {
    expect(isPaymentDetailsValid(baseData({ hasPaidAlready: true, paidAmount: '' }))).toBe(true);
  });

  it('requires a payment method once a positive amount is entered', () => {
    expect(isPaymentDetailsValid(baseData({ hasPaidAlready: true, paidAmount: '40000', paymentMethod: '' }))).toBe(false);
    expect(isPaymentDetailsValid(baseData({ hasPaidAlready: true, paidAmount: '40000', paymentMethod: 'Cash' }))).toBe(
      true,
    );
  });
});

describe('buildPreviewDisplay', () => {
  const worked: InviteSettlementPreviewResponse = {
    allocations: [
      {
        obligation_id: 'preview-security-deposit',
        type: 'SECURITY_DEPOSIT',
        rent_month: null,
        amount_due: 16000,
        outstanding: 0,
        allocated: 16000,
        result: 'PAID',
      },
      {
        obligation_id: 'preview-rent-2026-08',
        type: 'RENT',
        rent_month: '2026-08-01T00:00:00.000Z',
        amount_due: 8000,
        outstanding: 0,
        allocated: 8000,
        result: 'PAID',
      },
      {
        obligation_id: 'preview-rent-2026-09',
        type: 'RENT',
        rent_month: '2026-09-01T00:00:00.000Z',
        amount_due: 8000,
        outstanding: 0,
        allocated: 8000,
        result: 'PAID',
      },
      {
        obligation_id: 'preview-rent-2026-10',
        type: 'RENT',
        rent_month: '2026-10-01T00:00:00.000Z',
        amount_due: 8000,
        outstanding: 0,
        allocated: 8000,
        result: 'PAID',
      },
    ],
    unallocated: 0,
    total_outstanding: 40000,
    total_to_settle: 40000,
    remaining_outstanding: 0,
    payment_accepted: true,
    rejection_reason: null,
    rent_months: ['2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'],
  };

  it('renders the worked example from the spec: deposit, three rent months, Nov onwards outstanding', () => {
    const display = buildPreviewDisplay(worked, { paidAmount: 40000, monthlyRent: 8000 });
    expect(display.headline).toBe('₹40,000 received');
    expect(display.lines).toEqual([
      { key: 'preview-security-deposit', label: 'Deposit', amount: 16000 },
      { key: 'preview-rent-2026-08', label: 'Aug rent', amount: 8000 },
      { key: 'preview-rent-2026-09', label: 'Sep', amount: 8000 },
      { key: 'preview-rent-2026-10', label: 'Oct', amount: 8000 },
    ]);
    expect(display.outstandingLabel).toBe('Nov onwards');
    expect(display.overpaidAmount).toBe(0);
    expect(display.warning).toBeNull();
  });

  it('omits the outstanding line when there is no monthly rent at all', () => {
    const display = buildPreviewDisplay(worked, { paidAmount: 40000, monthlyRent: 0 });
    expect(display.outstandingLabel).toBeNull();
  });

  it('points the outstanding line at the first partially-paid rent month, not the last covered one', () => {
    const partial: InviteSettlementPreviewResponse = {
      ...worked,
      allocations: worked.allocations.map((a) =>
        a.obligation_id === 'preview-rent-2026-09' ? { ...a, allocated: 3000, outstanding: 5000, result: 'PARTIAL' as const } : a,
      ),
      remaining_outstanding: 5000,
    };
    const display = buildPreviewDisplay(partial, { paidAmount: 27000, monthlyRent: 8000 });
    expect(display.outstandingLabel).toBe('Sep onwards');
  });

  it('names the excess past the agreement, and the figure that can be recorded instead (ADR-236)', () => {
    const overpaid: InviteSettlementPreviewResponse = {
      ...worked,
      unallocated: 8200,
      total_to_settle: 90200,
      max_recordable: 90200,
      agreement: { duration_months: 11, last_month: '2027-06-01T00:00:00.000Z' },
    };
    const display = buildPreviewDisplay(overpaid, { paidAmount: 98400, monthlyRent: 8200 });
    expect(display.overpaidAmount).toBe(8200);
    expect(display.maxRecordable).toBe(90200);
    expect(display.warning).toBe(
      "₹8,200 remains after covering the whole 11-month agreement (through Jun 2027). Stayo doesn't hold extra money as credit, so record ₹90,200 or less, or lengthen the agreement.",
    );
    expect(isPaidAmountRecordable(overpaid)).toBe(false);
  });

  it('surfaces the backend rejection reason when the payment was not accepted and nothing was overpaid', () => {
    const rejected: InviteSettlementPreviewResponse = {
      ...worked,
      allocations: [],
      unallocated: 0,
      total_outstanding: 0,
      total_to_settle: 0,
      payment_accepted: false,
      rejection_reason: 'This hostel accepts part payments of ₹500 or more',
    };
    const display = buildPreviewDisplay(rejected, { paidAmount: 0.4, monthlyRent: 8000 });
    expect(display.warning).toBe('This hostel accepts part payments of ₹500 or more');
  });
});

describe('previewBlockers', () => {
  const ready = (over: Partial<InviteWizardData> = {}): InviteWizardData => ({
    ...EMPTY_INVITE_WIZARD_DATA,
    hostelId: 'h-1',
    joiningDate: '2026-09-01',
    monthlyRent: '8000',
    agreementMonths: '11',
    hasPaidAlready: true,
    paidAmount: '16000',
    ...over,
  });

  it('is empty once the owner has said enough to settle against', () => {
    expect(previewBlockers(ready())).toEqual([]);
    expect(describePreviewBlockers(ready())).toBeNull();
  });

  it('names the missing field rather than rendering an empty panel', () => {
    // The screen used to show a headed box with nothing in it: no figure, no
    // spinner, no reason, leaving the owner to guess which field it wanted.
    expect(describePreviewBlockers(ready({ agreementMonths: '' })))
      .toBe('Add how long the agreement runs to see how this payment settles.');
  });

  it('refuses to settle against a rent of zero', () => {
    // This used to fall back to 0, which produced a confident wrong answer:
    // every rupee read as advance credit because nothing was ever owed.
    expect(previewBlockers(ready({ monthlyRent: '' }))).toContain('the monthly rent');
    expect(isPreviewRequestReady(ready({ monthlyRent: '' }))).toBe(false);
  });

  it('lists several missing fields readably', () => {
    expect(describePreviewBlockers(ready({ monthlyRent: '', agreementMonths: '' })))
      .toBe('Add the monthly rent and how long the agreement runs to see how this payment settles.');
  });

  it('says nothing at all while the toggle is off', () => {
    expect(describePreviewBlockers(ready({ hasPaidAlready: false }))).toBeNull();
    expect(isPreviewRequestReady(ready({ hasPaidAlready: false }))).toBe(false);
  });

  it('still asks for the amount when the toggle is on but nothing is typed', () => {
    expect(describePreviewBlockers(ready({ paidAmount: '' })))
      .toContain('how much they have paid');
  });
});

/**
 * The figure an owner is really checking: after this cash lands, what is still
 * owed? The panel used to name only the month the tenant falls behind, which
 * answers "when" and not "how much".
 */
describe('buildPreviewDisplay — remaining balance', () => {
  const base: InviteSettlementPreviewResponse = {
    allocations: [],
    unallocated: 0,
    total_outstanding: 40000,
    total_to_settle: 16000,
    remaining_outstanding: 24000,
    payment_accepted: true,
    rejection_reason: null,
    rent_months: [],
  };

  it('carries the backend’s own remaining figure through, never recomputing it', () => {
    const display = buildPreviewDisplay(base, { paidAmount: 16000, monthlyRent: 8000 });
    expect(display.remainingOutstanding).toBe(24000);
  });

  it('reports 0 when the payment settles everything', () => {
    const display = buildPreviewDisplay(
      { ...base, remaining_outstanding: 0 },
      { paidAmount: 40000, monthlyRent: 8000 },
    );
    expect(display.remainingOutstanding).toBe(0);
  });

  it('never reports a negative balance, so an over-payment reads as settled plus a warning', () => {
    const display = buildPreviewDisplay(
      { ...base, remaining_outstanding: -5000, unallocated: 5000 },
      { paidAmount: 45000, monthlyRent: 8000 },
    );
    expect(display.remainingOutstanding).toBe(0);
    expect(display.overpaidAmount).toBe(5000);
  });
});

describe('buildPreviewDisplay — paying ahead (ADR-236)', () => {
  const RENT = 8200;
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, 7 + i, 1)).toISOString());
  const rentAlloc = (iso: string, allocated = RENT): SettlementAllocationLite => ({
    obligation_id: `preview-rent-${iso.slice(0, 7)}`,
    type: 'RENT',
    rent_month: iso,
    amount_due: RENT,
    outstanding: RENT,
    allocated,
    result: allocated >= RENT ? 'PAID' : allocated > 0 ? 'PARTIAL' : 'UNCHANGED',
  });

  const yearUpFront: InviteSettlementPreviewResponse = {
    allocations: months.map((m) => rentAlloc(m)),
    unallocated: 0,
    total_outstanding: 98400,
    total_to_settle: 98400,
    remaining_outstanding: 0,
    payment_accepted: true,
    rejection_reason: null,
    rent_months: months.slice(0, 3),
    advance_rent_months: months.slice(3),
    coverage: {
      months_covered: 12,
      paid_through_month: months[11],
      partial: null,
      next_due_month: '2027-08-01T00:00:00.000Z',
      rent_allocated: 98400,
      future_rent_covered: 73800,
      current_due: 0,
    },
    agreement: { duration_months: 12, last_month: months[11] },
    max_recordable: 98400,
    owed_today: 24600,
  };

  it('₹98,400 reads as 12 months covered, paid through Jul 2027, nothing due now — never as an overpayment', () => {
    const display = buildPreviewDisplay(yearUpFront, { paidAmount: 98400, monthlyRent: RENT });
    expect(display.headline).toBe('₹98,400 received');
    expect(display.warning).toBeNull();
    expect(display.overpaidAmount).toBe(0);
    expect(display.remainingOutstanding).toBe(0);
    expect(display.coverage).toEqual({
      monthsCovered: 12,
      paidThroughLabel: 'Jul 2027',
      futureRentCovered: 73800,
      partialNote: null,
      nextDueLabel: 'Aug 2027',
    });
    expect(isPaidAmountRecordable(yearUpFront)).toBe(true);
  });

  it('collapses a year of rent into one ranged line instead of twelve', () => {
    const display = buildPreviewDisplay(yearUpFront, { paidAmount: 98400, monthlyRent: RENT });
    expect(display.lines).toEqual([
      { key: 'preview-rent-2026-08', label: 'Rent, Aug 2026 – Jul 2027 · 12 months', amount: 98400 },
    ]);
  });

  it('₹90,000 shows ten months plus ₹8,000 toward the next, and the ₹200 still to pay for it', () => {
    const allocs = months.slice(0, 10).map((m) => rentAlloc(m));
    allocs.push(rentAlloc(months[10], 8000));
    const preview: InviteSettlementPreviewResponse = {
      ...yearUpFront,
      allocations: allocs,
      total_to_settle: 90000,
      remaining_outstanding: 200,
      coverage: {
        months_covered: 10,
        paid_through_month: months[9],
        partial: { rent_month: months[10], allocated: 8000, remaining: 200 },
        next_due_month: months[10],
        rent_allocated: 90000,
        future_rent_covered: 65400,
        current_due: 0,
      },
    };
    const display = buildPreviewDisplay(preview, { paidAmount: 90000, monthlyRent: RENT });
    expect(display.coverage?.monthsCovered).toBe(10);
    expect(display.coverage?.paidThroughLabel).toBe('May 2027');
    expect(display.coverage?.partialNote).toBe('₹8,000 toward Jun 2027 rent — ₹200 still to pay for that month');
    // The ₹200 belongs to June 2027; nothing is due today.
    expect(display.remainingOutstanding).toBe(0);
    expect(display.lines).toEqual([
      { key: 'preview-rent-2026-08', label: 'Rent, Aug 2026 – May 2027 · 10 months', amount: 82000 },
      { key: 'preview-rent-2027-06', label: 'Jun 2027 rent (part)', amount: 8000 },
    ]);
  });

  it('an older backend without coverage still renders the plain per-line view', () => {
    const { coverage: _c, advance_rent_months: _a, agreement: _g, max_recordable: _m, owed_today: _o, ...legacy } = yearUpFront;
    const display = buildPreviewDisplay(legacy, { paidAmount: 98400, monthlyRent: RENT });
    expect(display.coverage).toBeNull();
    expect(display.remainingOutstanding).toBe(0);
  });
});

describe('paidOnError — when the money actually changed hands', () => {
  const JUNE = new Date(2026, 5, 10);
  const paid = (paidOn: string) =>
    baseData({ hasPaidAlready: true, paidAmount: '75000', paymentMethod: 'Cash', paidOn });

  it('accepts a blank date — it means today', () => {
    expect(paidOnError(paid(''), JUNE)).toBeNull();
    expect(isPaymentDetailsValid(paid(''), JUNE)).toBe(true);
  });

  it('accepts a payment made months before Stayo was introduced', () => {
    expect(paidOnError(paid('2026-01-03'), JUNE)).toBeNull();
    expect(isPaymentDetailsValid(paid('2026-01-03'), JUNE)).toBe(true);
  });

  it('accepts today', () => {
    expect(paidOnError(paid('2026-06-10'), JUNE)).toBeNull();
  });

  it('refuses a date in the future and holds the step back', () => {
    expect(paidOnError(paid('2026-06-11'), JUNE)).toBe('The payment date cannot be in the future.');
    expect(isPaymentDetailsValid(paid('2026-06-11'), JUNE)).toBe(false);
  });
});
