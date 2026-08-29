import { describe, expect, it } from 'vitest';
import { EMPTY_INVITE_WIZARD_DATA, type InviteWizardData } from '../types';
import {
  buildPreviewDisplay,
  buildPreviewRequestBody,
  isPaymentDetailsValid,
  isPreviewRequestReady,
  previewRequestKey,
  type InviteSettlementPreviewResponse,
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
    expect(display.outstandingLabel).toBe('Nov onwards outstanding');
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
    expect(display.outstandingLabel).toBe('Sep onwards outstanding');
  });

  it('flags an over-payment plainly instead of letting it surface only at submit', () => {
    const overpaid: InviteSettlementPreviewResponse = {
      ...worked,
      unallocated: 5000,
      total_to_settle: 40000,
    };
    const display = buildPreviewDisplay(overpaid, { paidAmount: 45000, monthlyRent: 8000 });
    expect(display.overpaidAmount).toBe(5000);
    expect(display.warning).toBe("₹5,000 is more than what's owed and won't be recorded");
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
