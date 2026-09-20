import { describe, expect, it } from 'vitest';
import { ownerPaymentMethodLabel, ownerPaymentStatusLabel } from './paymentsView';

describe('ownerPaymentMethodLabel', () => {
  it('labels each known method', () => {
    expect(ownerPaymentMethodLabel('CASH')).toBe('Cash');
    expect(ownerPaymentMethodLabel('UPI')).toBe('UPI');
    expect(ownerPaymentMethodLabel('BANK_TRANSFER')).toBe('Bank transfer');
  });

  it('falls back to the raw value for an unknown method', () => {
    expect(ownerPaymentMethodLabel('GATEWAY')).toBe('GATEWAY');
    expect(ownerPaymentMethodLabel(null)).toBe('—');
  });
});

describe('ownerPaymentStatusLabel', () => {
  it('shows Paid for a recorded payment and Voided for a voided one', () => {
    expect(ownerPaymentStatusLabel('RECORDED')).toBe('Paid');
    expect(ownerPaymentStatusLabel('VOIDED')).toBe('Voided');
  });
});
