import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant } from '../factories/tenant-factory';
import { createTestObligation } from '../factories/payment-factory';
import { tenantFinancialLedgerService } from '@/src/services/payments/tenant-financial-ledger-service';

// NOTE: mockImplementation must return a plain `function` (not an arrow
// function) — provider-factory.ts calls `new RazorpayProvider(config)`, and
// `new` on an arrow-function implementation throws "is not a constructor".
//
// gateway_txn_id is unique across payment_attempts (prisma/schema.prisma),
// so each createIntent() call must return a distinct value — otherwise the
// second test in this file collides with the first against the real test DB.
let mockGatewayTxnCounter = 0;
vi.mock('@/src/services/payments/providers/razorpay', () => ({
  RazorpayProvider: vi.fn().mockImplementation(function RazorpayProvider() {
    return {
      createIntent: vi.fn().mockImplementation(async () => {
        const gatewayTxnId = `order_test${++mockGatewayTxnCounter}`;
        return {
          provider: 'RAZORPAY',
          merchant_txn_id: 'test-txn',
          checkout_url: null,
          upi_intent_url: null,
          qr_payload: null,
          expires_at: null,
          gateway_txn_id: gatewayTxnId,
          provider_order_id: gatewayTxnId,
          provider_transaction_id: null,
          provider_reference_id: gatewayTxnId,
          raw_response: { id: gatewayTxnId, key_id: 'rzp_test_key' },
        };
      }),
    };
  }),
}));

import { paymentService } from '@/src/services/payments/payment-service';

describe('paymentService.createAmountPaymentIntent', () => {
  it('allocates a FIFO plan across obligations and links only the ones with allocated > 0', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);

    const obligation1 = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000,
      status: 'PENDING',
      billing_period_start: new Date(Date.UTC(2027, 0, 1)),
      due_date: new Date(Date.UTC(2027, 0, 5)),
      rent_month: new Date(Date.UTC(2027, 0, 1)),
    });
    const obligation2 = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000,
      status: 'PENDING',
      billing_period_start: new Date(Date.UTC(2027, 1, 1)),
      due_date: new Date(Date.UTC(2027, 1, 5)),
      rent_month: new Date(Date.UTC(2027, 1, 1)),
    });

    // Pay 10,000: fully covers obligation1 (8,000), partially covers obligation2 (2,000)
    const attempt = await paymentService.createAmountPaymentIntent(
      10000,
      owner.id,
      tenant.id,
      hostel.id,
      { bypassCollectionPolicy: true, source: 'PAYMENT_LINK' }
    );

    expect(Number((attempt as any).amount)).toBe(10000);

    const links = await prisma.payment_attempt_obligations.findMany({
      where: { payment_attempt_id: (attempt as any).id },
    });
    expect(links.length).toBe(2);
    const byObligation = Object.fromEntries(links.map((l) => [l.obligation_id, Number(l.amount)]));
    expect(byObligation[obligation1.id]).toBe(8000);
    expect(byObligation[obligation2.id]).toBe(2000);
  });

  it('creates a pure future-credit intent (no linked obligations) when the tenant owes nothing', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    // No obligations at all.

    const attempt = await paymentService.createAmountPaymentIntent(
      5000,
      owner.id,
      tenant.id,
      hostel.id,
      { bypassCollectionPolicy: true, source: 'PAYMENT_LINK' }
    );

    expect(Number((attempt as any).amount)).toBe(5000);

    const links = await prisma.payment_attempt_obligations.findMany({
      where: { payment_attempt_id: (attempt as any).id },
    });
    expect(links.length).toBe(0);

    const raw = (attempt as any).raw_create_response as any;
    expect(Array.isArray(raw?.allowed_obligation_ids)).toBe(true);
    expect(raw.allowed_obligation_ids.length).toBe(0);
  });

  it('rejects a zero or negative amount', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);

    await expect(
      paymentService.createAmountPaymentIntent(0, owner.id, tenant.id, hostel.id, { source: 'PAYMENT_LINK' })
    ).rejects.toThrow(/greater than zero/i);
  });
});

describe('paymentService.finalizePaymentAttempt — amount-first intents', () => {
  it('split-with-remainder: pays off both obligations and credits the leftover as future rent', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);

    const obligation1 = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000,
      status: 'PENDING',
      billing_period_start: new Date(Date.UTC(2027, 2, 1)),
      due_date: new Date(Date.UTC(2027, 2, 5)),
      rent_month: new Date(Date.UTC(2027, 2, 1)),
    });
    const obligation2 = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000,
      status: 'PENDING',
      billing_period_start: new Date(Date.UTC(2027, 3, 1)),
      due_date: new Date(Date.UTC(2027, 3, 5)),
      rent_month: new Date(Date.UTC(2027, 3, 1)),
    });

    // Total outstanding is 16,000. Pay 20,000 — 4,000 should land as future credit.
    const attempt = await paymentService.createAmountPaymentIntent(
      20000,
      owner.id,
      tenant.id,
      hostel.id,
      { bypassCollectionPolicy: true, source: 'PAYMENT_LINK' }
    );

    const finalized: any = await paymentService.finalizePaymentAttempt(
      (attempt as any).id,
      'SUCCESS',
      (attempt as any).gateway_txn_id
    );
    expect(finalized.status).toBe('SUCCESS');

    const [refreshedObligation1, refreshedObligation2] = await Promise.all([
      prisma.rent_obligations.findUniqueOrThrow({ where: { id: obligation1.id } }),
      prisma.rent_obligations.findUniqueOrThrow({ where: { id: obligation2.id } }),
    ]);
    expect(refreshedObligation1.status).toBe('PAID');
    expect(refreshedObligation2.status).toBe('PAID');

    const balance = await tenantFinancialLedgerService.getBalance(tenant.id, owner.id);
    expect(balance.future_rent_credit).toBe(4000);
  });

  it('appeared-in-between: a pure future-credit intent ([]) does not sweep an obligation created after intent-creation', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    // No obligations at intent-creation time — pure future-credit intent.

    const attempt = await paymentService.createAmountPaymentIntent(
      6000,
      owner.id,
      tenant.id,
      hostel.id,
      { bypassCollectionPolicy: true, source: 'PAYMENT_LINK' }
    );

    const raw = (attempt as any).raw_create_response as any;
    expect(raw.allowed_obligation_ids).toEqual([]);

    // An obligation appears between intent-creation and payment confirmation.
    const lateObligation = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 5000,
      status: 'PENDING',
      billing_period_start: new Date(Date.UTC(2027, 4, 1)),
      due_date: new Date(Date.UTC(2027, 4, 5)),
      rent_month: new Date(Date.UTC(2027, 4, 1)),
    });

    const finalized: any = await paymentService.finalizePaymentAttempt(
      (attempt as any).id,
      'SUCCESS',
      (attempt as any).gateway_txn_id
    );
    expect(finalized.status).toBe('SUCCESS');

    // Critical safety property: allowed_obligation_ids: [] means "allocate to
    // none / all future credit" — it must NOT be treated as "no restriction"
    // and sweep whatever obligations exist at finalization time.
    const refreshedLateObligation = await prisma.rent_obligations.findUniqueOrThrow({
      where: { id: lateObligation.id },
    });
    expect(refreshedLateObligation.status).toBe('PENDING');

    const links = await prisma.payment_attempt_obligations.findMany({
      where: { payment_attempt_id: (attempt as any).id },
    });
    expect(links.length).toBe(0);

    const balance = await tenantFinancialLedgerService.getBalance(tenant.id, owner.id);
    expect(balance.future_rent_credit).toBe(6000);
  });
});
