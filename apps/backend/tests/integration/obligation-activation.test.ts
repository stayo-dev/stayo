import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant, allocateTestRoom } from '../factories/tenant-factory';
import { createTestRoom } from '../factories/room-factory';
import { createTestObligation } from '../factories/payment-factory';
import { financialLifecycleService } from '@/src/services/payments/financial-lifecycle-service';
import { financialPaymentFacade } from '@/src/services/payments/financial-payment-facade';

describe('FinancialLifecycleService.activatePayableObligations', () => {
  let owner: any;
  let hostel: any;
  let tenant: any;
  let room: any;

  beforeEach(async () => {
    owner = await createTestOwner();
    hostel = await createTestHostel(owner.id);
    room = await createTestRoom(hostel.id);
    tenant = await createTestTenant(owner.id, hostel.id);
    await allocateTestRoom(tenant.id, room.id, { hostel_id: hostel.id });
  });

  it('activates a credit-free UPCOMING obligation to PENDING only, with no ledger/payment side effects (Scenario 4)', async () => {
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'UPCOMING',
    });

    const results = await prisma.$transaction((tx: any) =>
      financialLifecycleService.activatePayableObligations(tx, {
        tenantId: tenant.id, ownerId: owner.id, hostelId: hostel.id,
        obligationIds: [obligation.id],
      })
    );

    expect(results).toEqual([{ id: obligation.id, previousStatus: 'UPCOMING', newStatus: 'PENDING' }]);

    const refreshed = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: obligation.id } });
    expect(refreshed.status).toBe('PENDING');

    const payments = await prisma.payments.findMany({ where: { obligation_id: obligation.id } });
    expect(payments).toHaveLength(0);

    const ledgerEntries = await prisma.tenant_financial_ledger.findMany({ where: { tenant_id: tenant.id } });
    expect(ledgerEntries).toHaveLength(0);
  });

  it('sweeps future rent credit against a newly activated obligation (Scenario 1 — the bug 2 reproduction)', async () => {
    // July: rent obligation for 8000, overpaid by 10000 -> 2000 future credit.
    const julyObligation = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'PENDING',
      rent_month: new Date(Date.UTC(2026, 6, 1)), due_date: new Date(Date.UTC(2026, 6, 5)),
    });

    await prisma.$transaction((tx: any) =>
      financialPaymentFacade.receivePayment(tx, {
        hostelId: hostel.id, tenantId: tenant.id, amountPaid: 10000, paymentMethod: 'UPI',
        ownerId: owner.id, userId: owner.id,
      }, 'test-group-1')
    );

    const topupEntries = await prisma.tenant_financial_ledger.findMany({
      where: { tenant_id: tenant.id, reason: 'FUTURE_RENT_CREDIT_TOPUP' },
    });
    expect(topupEntries).toHaveLength(1);
    expect(Number(topupEntries[0].amount)).toBe(2000);

    // August: rent obligation for 8000, created UPCOMING (not yet activated).
    const augustObligation = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'UPCOMING',
      rent_month: new Date(Date.UTC(2026, 7, 1)), due_date: new Date(Date.UTC(2026, 7, 5)),
    });

    await prisma.$transaction((tx: any) =>
      financialLifecycleService.activatePayableObligations(tx, {
        tenantId: tenant.id, ownerId: owner.id, hostelId: hostel.id,
        obligationIds: [augustObligation.id],
      })
    );

    const refreshedAugust = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: augustObligation.id } });
    expect(refreshedAugust.status).toBe('PARTIAL');

    const augustPayments = await prisma.payments.findMany({ where: { obligation_id: augustObligation.id } });
    const augustPaid = augustPayments.reduce((sum: number, p: any) => sum + Number(p.amount_paid), 0);
    expect(augustPaid).toBe(2000);
    expect(8000 - augustPaid).toBe(6000);

    // Future credit ledger balance is now fully consumed.
    const allEntries = await prisma.tenant_financial_ledger.findMany({ where: { tenant_id: tenant.id } });
    const balance = allEntries.reduce(
      (sum: number, e: any) => sum + (e.type === 'CREDIT' ? Number(e.amount) : -Number(e.amount)), 0
    );
    expect(balance).toBe(0);

    const appliedEntries = await prisma.tenant_financial_ledger.findMany({
      where: { tenant_id: tenant.id, reason: 'FUTURE_CREDIT_APPLIED' },
    });
    expect(appliedEntries).toHaveLength(1);
    expect(Number(appliedEntries[0].amount)).toBe(2000);
    expect(appliedEntries[0].type).toBe('DEBIT');

    void julyObligation;
  });

  it('does not re-apply credit or duplicate the ledger entry when activation is called twice for the same obligation (Scenario 5 — idempotency)', async () => {
    const julyObligation = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'PENDING',
      rent_month: new Date(Date.UTC(2026, 6, 1)), due_date: new Date(Date.UTC(2026, 6, 5)),
    });
    await prisma.$transaction((tx: any) =>
      financialPaymentFacade.receivePayment(tx, {
        hostelId: hostel.id, tenantId: tenant.id, amountPaid: 10000, paymentMethod: 'UPI',
        ownerId: owner.id, userId: owner.id,
      }, 'test-group-2')
    );

    const augustObligation = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'UPCOMING',
      rent_month: new Date(Date.UTC(2026, 7, 1)), due_date: new Date(Date.UTC(2026, 7, 5)),
    });

    const activate = () => prisma.$transaction((tx: any) =>
      financialLifecycleService.activatePayableObligations(tx, {
        tenantId: tenant.id, ownerId: owner.id, hostelId: hostel.id,
        obligationIds: [augustObligation.id],
      })
    );

    const firstResult = await activate();
    expect(firstResult).toEqual([{ id: augustObligation.id, previousStatus: 'UPCOMING', newStatus: 'PENDING' }]);

    const afterFirst = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: augustObligation.id } });
    const afterFirstPaid = (await prisma.payments.findMany({ where: { obligation_id: augustObligation.id } }))
      .reduce((sum: number, p: any) => sum + Number(p.amount_paid), 0);
    expect(afterFirst.status).toBe('PARTIAL');
    expect(afterFirstPaid).toBe(2000);

    // Second activation call for the same, now-already-PENDING/PARTIAL
    // obligation — markObligationsPayableInTx's idempotency guard means
    // this is a no-op status transition, and there is no remaining credit
    // balance to re-apply.
    const secondResult = await activate();
    expect(secondResult).toEqual([{ id: augustObligation.id, previousStatus: 'PARTIAL', newStatus: 'PARTIAL' }]);

    const afterSecond = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: augustObligation.id } });
    const afterSecondPaid = (await prisma.payments.findMany({ where: { obligation_id: augustObligation.id } }))
      .reduce((sum: number, p: any) => sum + Number(p.amount_paid), 0);
    expect(afterSecond.status).toBe('PARTIAL');
    expect(afterSecondPaid).toBe(2000); // unchanged — no double application

    const allEntries = await prisma.tenant_financial_ledger.findMany({ where: { tenant_id: tenant.id } });
    const balance = allEntries.reduce(
      (sum: number, e: any) => sum + (e.type === 'CREDIT' ? Number(e.amount) : -Number(e.amount)), 0
    );
    expect(balance).toBe(0); // never goes negative

    const appliedEntries = await prisma.tenant_financial_ledger.findMany({
      where: { tenant_id: tenant.id, reason: 'FUTURE_CREDIT_APPLIED' },
    });
    expect(appliedEntries).toHaveLength(1); // still exactly one — no duplicate

    void julyObligation;
  });

  it('sweeps credit across two simultaneously-activated obligations with a single applyAvailableCredits call, in settlement priority order (Scenario 3)', async () => {
    // Fund the tenant with a 15000 future credit via an overpayment against
    // an already-settled obligation.
    const seedObligation = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 1000, total_amount: 1000, status: 'PENDING',
      obligation_type: 'MAINTENANCE',
      rent_month: new Date(Date.UTC(2026, 5, 1)), due_date: new Date(Date.UTC(2026, 5, 5)),
    });
    await prisma.$transaction((tx: any) =>
      financialPaymentFacade.receivePayment(tx, {
        hostelId: hostel.id, tenantId: tenant.id, amountPaid: 16000, paymentMethod: 'UPI',
        ownerId: owner.id, userId: owner.id,
      }, 'test-group-3')
    );

    const securityDeposit = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 5000, total_amount: 5000, status: 'UPCOMING', obligation_type: 'SECURITY_DEPOSIT',
      rent_month: new Date(Date.UTC(2026, 7, 1)), due_date: new Date(Date.UTC(2026, 7, 5)),
    });
    const rent = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'UPCOMING', obligation_type: 'RENT',
      rent_month: new Date(Date.UTC(2026, 7, 1)), due_date: new Date(Date.UTC(2026, 7, 5)),
    });

    const applySpy = vi.spyOn(financialPaymentFacade, 'applyAvailableCredits');

    await prisma.$transaction((tx: any) =>
      financialLifecycleService.activatePayableObligations(tx, {
        tenantId: tenant.id, ownerId: owner.id, hostelId: hostel.id,
        obligationIds: [securityDeposit.id, rent.id],
      })
    );

    expect(applySpy).toHaveBeenCalledTimes(1);
    applySpy.mockRestore();

    // Priority order: SECURITY_DEPOSIT before RENT — both should be fully
    // paid (5000 + 8000 = 13000 of the 15000 available credit).
    const refreshedDeposit = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: securityDeposit.id } });
    const refreshedRent = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: rent.id } });
    expect(refreshedDeposit.status).toBe('PAID');
    expect(refreshedRent.status).toBe('PAID');

    // Exactly one FUTURE_CREDIT_APPLIED debit, for the full 13000 swept
    // across both obligations in a single sweep call.
    const appliedEntries = await prisma.tenant_financial_ledger.findMany({
      where: { tenant_id: tenant.id, reason: 'FUTURE_CREDIT_APPLIED' },
    });
    expect(appliedEntries).toHaveLength(1);
    expect(Number(appliedEntries[0].amount)).toBe(13000);

    // Raw ledger balance is 15000 (topup) + 5000 (SECURITY_DEPOSIT_COLLECTED
    // — a side-effect credit the Settlement Engine always writes when a
    // SECURITY_DEPOSIT obligation is paid off, funding-source-agnostic) -
    // 13000 (applied) = 7000. This is NOT the future-rent-credit balance
    // (which nets out the security-deposit portion) — just confirming the
    // full picture of every entry this sweep produced, with nothing
    // unaccounted for.
    const allEntries = await prisma.tenant_financial_ledger.findMany({ where: { tenant_id: tenant.id } });
    const balance = allEntries.reduce(
      (sum: number, e: any) => sum + (e.type === 'CREDIT' ? Number(e.amount) : -Number(e.amount)), 0
    );
    expect(balance).toBe(7000);

    void seedObligation;
  });
});
