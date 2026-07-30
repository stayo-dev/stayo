import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant } from '../factories/tenant-factory';
import { createTestObligation, createTestPayment } from '../factories/payment-factory';
import { reverseObligationPayment } from '@/src/services/payments/corrections/payment-correction-shared';
import { tenantFinancialLedgerService } from '@/src/services/payments/tenant-financial-ledger-service';
import { recoveryService } from '@/src/services/recovery/recovery-service';
import { correctionRegistry } from '@/src/services/recovery/correction-registry';
import '@/src/services/payments/corrections/payment-reversal-handler'; // registers itself

describe('reverseObligationPayment', () => {
  it('writes a negative reversal payment row and restores obligation outstanding, without mutating the original payment (RENT obligation: no ledger entry)', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, { amount: 10000 });
    const payment = await createTestPayment(obligation.id, 10000);

    const result = await prisma.$transaction(async (tx) => {
      return reverseObligationPayment(tx, {
        hostelId: hostel.id,
        payment,
        correctionCaseId: '11111111-1111-4111-8111-111111111111',
        actorId: owner.id,
        reason: 'wrong tenant',
      });
    });

    expect(result.newSettlementStatus).toBe('UNPAID');

    const originalUnchanged = await prisma.payments.findUniqueOrThrow({ where: { id: payment.id } });
    expect(Number(originalUnchanged.amount_paid)).toBe(10000);

    const reversalRow = await prisma.payments.findUniqueOrThrow({ where: { id: result.reversalPaymentId } });
    expect(Number(reversalRow.amount_paid)).toBe(-10000);
    expect(reversalRow.obligation_id).toBe(obligation.id);

    const updatedObligation = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: obligation.id } });
    expect(updatedObligation.settlement_status).toBe('UNPAID');

    // RENT is not ADVANCE/SECURITY_DEPOSIT, so the original payment's allocation
    // never wrote a ledger credit (see settlement-engine.ts) — there is nothing
    // for a reversal to undo, so no LEDGER_CORRECTION debit should be written.
    expect(result.ledgerEntryId).toBeNull();
    const ledgerRows = await prisma.tenant_financial_ledger.findMany({ where: { tenant_id: tenant.id } });
    expect(ledgerRows).toHaveLength(0);
  });

  it('writes a LEDGER_CORRECTION debit when reversing a payment on a SECURITY_DEPOSIT obligation', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 10000,
      obligation_type: 'SECURITY_DEPOSIT',
    });
    const payment = await createTestPayment(obligation.id, 10000);

    const result = await prisma.$transaction(async (tx) => {
      return reverseObligationPayment(tx, {
        hostelId: hostel.id,
        payment,
        correctionCaseId: '33333333-3333-4333-8333-333333333333',
        actorId: owner.id,
        reason: 'wrong tenant',
      });
    });

    expect(result.newSettlementStatus).toBe('UNPAID');

    // SECURITY_DEPOSIT/ADVANCE obligations DO get a ledger credit when paid
    // (settlement-engine.ts), so reversing must still undo it with a debit.
    expect(result.ledgerEntryId).not.toBeNull();
    const ledgerEntry = await prisma.tenant_financial_ledger.findUniqueOrThrow({ where: { id: result.ledgerEntryId! } });
    expect(ledgerEntry.reason).toBe('LEDGER_CORRECTION');
    expect(Number(ledgerEntry.amount)).toBe(10000);
  });

  it('does not reduce a tenant\'s unrelated future-rent-credit balance when a RENT payment is reversed', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, { amount: 10000 });
    const payment = await createTestPayment(obligation.id, 10000);

    // Tenant separately holds real future-rent-credit from an unrelated,
    // legitimate ledger CREDIT (e.g. a TOPUP unconnected to this obligation).
    await tenantFinancialLedgerService.credit({
      tenantId: tenant.id,
      ownerId: owner.id,
      createdBy: owner.id,
      reason: 'TOPUP',
      amount: 5000,
      notes: 'Unrelated future rent credit top-up',
    });

    const balanceBefore = await tenantFinancialLedgerService.getBalance(tenant.id, owner.id);
    expect(balanceBefore.future_rent_credit).toBe(5000);

    await prisma.$transaction(async (tx) => {
      return reverseObligationPayment(tx, {
        hostelId: hostel.id,
        payment,
        correctionCaseId: '44444444-4444-4444-8444-444444444444',
        actorId: owner.id,
        reason: 'wrong tenant',
      });
    });

    const balanceAfter = await tenantFinancialLedgerService.getBalance(tenant.id, owner.id);
    expect(balanceAfter.future_rent_credit).toBe(5000);
    expect(balanceAfter.balance).toBe(balanceBefore.balance);
  });

  it('is safe to call twice with the same correctionCaseId (idempotent retry)', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, { amount: 5000 });
    const payment = await createTestPayment(obligation.id, 5000);

    const params = { hostelId: hostel.id, payment, correctionCaseId: '22222222-2222-4222-8222-222222222222', actorId: owner.id, reason: 'retry test' };

    const first = await prisma.$transaction(async (tx) => reverseObligationPayment(tx, params));
    const second = await prisma.$transaction(async (tx) => reverseObligationPayment(tx, params));

    expect(second.reversalPaymentId).toBe(first.reversalPaymentId);

    const reversalRows = await prisma.payments.findMany({ where: { obligation_id: obligation.id, amount_paid: { lt: 0 } } });
    expect(reversalRows).toHaveLength(1);
  });
});

describe('paymentReversalHandler (end to end via recoveryService)', () => {
  it('goes DRAFT -> PREVIEW -> VALIDATED -> COMPLETED and creates a reversal payment', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, { amount: 8000 });
    const payment = await createTestPayment(obligation.id, 8000);

    expect(correctionRegistry.has('PAYMENT_REVERSAL')).toBe(true);

    const kase = await recoveryService.createCase('PAYMENT_REVERSAL', {
      hostelId: hostel.id,
      actor: { actorId: owner.id, actorRole: 'OWNER' },
      reason: 'recorded against wrong tenant',
      input: { paymentId: payment.id },
    });
    expect(kase.status).toBe('DRAFT');

    // obligation here is RENT-type (factory default), so per the fix in
    // payment-correction-shared.ts the preview must not promise a ledger
    // correction entry that execute will not actually create.
    const impact = await recoveryService.preview(kase.id);
    expect(impact.ledgerEntries).toHaveLength(0);

    const validation = await recoveryService.validate(kase.id);
    expect(validation.allowed).toBe(true);

    const executed = await recoveryService.execute(kase.id, { actorId: owner.id, actorRole: 'OWNER' });
    expect(executed.status).toBe('COMPLETED');

    const reversalRows = await prisma.payments.findMany({ where: { obligation_id: obligation.id, amount_paid: { lt: 0 } } });
    expect(reversalRows).toHaveLength(1);

    const updatedObligation = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: obligation.id } });
    expect(updatedObligation.settlement_status).toBe('UNPAID');
  });

  it('policy refuses a second reversal case for an already-reversed payment', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, { amount: 3000 });
    const payment = await createTestPayment(obligation.id, 3000);

    const first = await recoveryService.createCase('PAYMENT_REVERSAL', {
      hostelId: hostel.id, actor: { actorId: owner.id, actorRole: 'OWNER' }, reason: 'x',
      input: { paymentId: payment.id },
    });
    await recoveryService.preview(first.id);
    await recoveryService.validate(first.id);
    await recoveryService.execute(first.id, { actorId: owner.id, actorRole: 'OWNER' });

    // Attempting to create+validate a second case for the SAME payment must be
    // rejected by the policy even though it's a distinct idempotency key
    // (different reason string changes nothing about idempotency_key, which is
    // keyed purely on paymentId — so this actually hits the SAME case).
    const second = await recoveryService.createCase('PAYMENT_REVERSAL', {
      hostelId: hostel.id, actor: { actorId: owner.id, actorRole: 'OWNER' }, reason: 'trying again',
      input: { paymentId: payment.id },
    });
    expect(second.id).toBe(first.id); // idempotency key collision returns the same, already-COMPLETED case

    await expect(recoveryService.validate(second.id)).resolves.toEqual(
      expect.objectContaining({ allowed: expect.any(Boolean) })
    );
  });

  it('refuses to create a case when the payment belongs to a different hostel than claimed', async () => {
    const owner = await createTestOwner();
    const hostelA = await createTestHostel(owner.id);
    const hostelB = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostelA.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostelA.id, { amount: 4000 });
    const payment = await createTestPayment(obligation.id, 4000);

    // payment actually belongs to hostelA, but the case is created claiming hostelB
    await expect(
      recoveryService.createCase('PAYMENT_REVERSAL', {
        hostelId: hostelB.id,
        actor: { actorId: owner.id, actorRole: 'OWNER' },
        reason: 'cross-hostel attempt',
        input: { paymentId: payment.id },
      })
    ).rejects.toThrow(`Payment ${payment.id} does not belong to hostel ${hostelB.id}`);
  });
});
