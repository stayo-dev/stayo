import { describe, expect, it } from 'vitest';
import {
  invoiceEmailNeedsAttention,
  invoiceWhatsAppNeedsAttention,
  OWNER_PAYMENT_DESCRIPTION_MAX_LENGTH,
  ownerPaymentMethodLabel,
  validateAddOwnerPaymentForm,
  whatsAppStatusLabel,
} from './ownerPaymentsView';

describe('ownerPaymentMethodLabel', () => {
  it('labels each known method', () => {
    expect(ownerPaymentMethodLabel('CASH')).toBe('Cash');
    expect(ownerPaymentMethodLabel('UPI')).toBe('UPI');
    expect(ownerPaymentMethodLabel('BANK_TRANSFER')).toBe('Bank transfer');
  });

  it('is case-insensitive and falls back to the raw value', () => {
    expect(ownerPaymentMethodLabel('cash')).toBe('Cash');
    expect(ownerPaymentMethodLabel('GATEWAY')).toBe('GATEWAY');
    expect(ownerPaymentMethodLabel(null)).toBe('—');
  });
});

describe('validateAddOwnerPaymentForm', () => {
  const base = { amountRupees: '500', paymentMethod: 'CASH', description: 'Tenant onboarding cost' };

  it('accepts a valid form and converts rupees to paise', () => {
    const result = validateAddOwnerPaymentForm(base);
    expect(result.ok).toBe(true);
    expect(result.amountPaise).toBe(50000);
  });

  it('rejects a missing/zero/negative amount', () => {
    expect(validateAddOwnerPaymentForm({ ...base, amountRupees: '' }).ok).toBe(false);
    expect(validateAddOwnerPaymentForm({ ...base, amountRupees: '0' }).ok).toBe(false);
    expect(validateAddOwnerPaymentForm({ ...base, amountRupees: '-50' }).ok).toBe(false);
  });

  it('rejects a missing or unknown payment method', () => {
    expect(validateAddOwnerPaymentForm({ ...base, paymentMethod: '' }).ok).toBe(false);
    expect(validateAddOwnerPaymentForm({ ...base, paymentMethod: 'GATEWAY' }).ok).toBe(false);
  });

  it('rejects a missing description', () => {
    expect(validateAddOwnerPaymentForm({ ...base, description: '   ' }).ok).toBe(false);
  });

  it('rejects a description over the max length', () => {
    const tooLong = 'x'.repeat(OWNER_PAYMENT_DESCRIPTION_MAX_LENGTH + 1);
    const result = validateAddOwnerPaymentForm({ ...base, description: tooLong });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/240/);
  });

  it('rejects notes over the max length', () => {
    const tooLong = 'x'.repeat(1001);
    expect(validateAddOwnerPaymentForm({ ...base, notes: tooLong }).ok).toBe(false);
  });

  it('rounds fractional rupees to the nearest paisa', () => {
    const result = validateAddOwnerPaymentForm({ ...base, amountRupees: '99.999' });
    expect(result.ok).toBe(true);
    expect(result.amountPaise).toBe(10000);
  });
});

describe('invoiceEmailNeedsAttention', () => {
  const rowBase = {
    id: 'p1',
    amount_paise: 50000,
    payment_method: 'CASH',
    description: 'Tenant onboarding cost',
    status: 'RECORDED',
    created_at: '2026-09-20T00:00:00.000Z',
  };

  it('is true when the invoice failed to send and was never emailed', () => {
    expect(
      invoiceEmailNeedsAttention({
        ...rowBase,
        invoice: {
          id: 'i1',
          invoice_number: 'STY-2026-0001',
          email: { sent: false, sent_at: null, failed_at: '2026-09-20T00:00:00.000Z' },
          whatsapp: { status: 'PENDING' },
        },
      }),
    ).toBe(true);
  });

  it('is false once the invoice has been emailed', () => {
    expect(
      invoiceEmailNeedsAttention({
        ...rowBase,
        invoice: {
          id: 'i1',
          invoice_number: 'STY-2026-0001',
          email: { sent: true, sent_at: '2026-09-20T00:00:00.000Z', failed_at: null },
          whatsapp: { status: 'PENDING' },
        },
      }),
    ).toBe(false);
  });

  it('is false when there is no invoice at all', () => {
    expect(invoiceEmailNeedsAttention({ ...rowBase, invoice: null })).toBe(false);
  });
});

describe('invoiceWhatsAppNeedsAttention / whatsAppStatusLabel', () => {
  const rowBase = {
    id: 'p1',
    amount_paise: 50000,
    payment_method: 'CASH',
    description: 'Tenant onboarding cost',
    status: 'RECORDED',
    created_at: '2026-09-20T00:00:00.000Z',
  };
  const invoiceBase = { id: 'i1', invoice_number: 'STY-2026-0001', email: { sent: true } };

  it('needs attention only when WhatsApp status is FAILED', () => {
    expect(invoiceWhatsAppNeedsAttention({ ...rowBase, invoice: { ...invoiceBase, whatsapp: { status: 'FAILED', error: 'boom' } } as any })).toBe(true);
    expect(invoiceWhatsAppNeedsAttention({ ...rowBase, invoice: { ...invoiceBase, whatsapp: { status: 'SENT' } } as any })).toBe(false);
    expect(invoiceWhatsAppNeedsAttention({ ...rowBase, invoice: { ...invoiceBase, whatsapp: { status: 'PENDING' } } as any })).toBe(false);
    expect(invoiceWhatsAppNeedsAttention({ ...rowBase, invoice: null })).toBe(false);
  });

  it('labels each status', () => {
    expect(whatsAppStatusLabel('SENT')).toBe('Sent');
    expect(whatsAppStatusLabel('FAILED')).toBe('Failed');
    expect(whatsAppStatusLabel('PENDING')).toBe('Pending');
    expect(whatsAppStatusLabel(undefined)).toBe('Pending');
  });
});
