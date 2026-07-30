import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from './factories/owner-factory';
import { createTestTenant, allocateTestRoom } from './factories/tenant-factory';
import { createTestRoom } from './factories/room-factory';
import { createTestObligation, createTestPayment } from './factories/payment-factory';
import { financialService } from '@/src/services/payments/financial-service';
import { tenantFinancialLedgerService } from '@/src/services/payments/tenant-financial-ledger-service';
import { financialReadModelService } from '@/src/services/payments/financial-read-model-service';

const daysFromNow = (days: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

describe('FinancialReadModelService — composition, not reimplementation', () => {
  let owner: any;
  let hostel: any;
  let tenant: any;
  let room: any;

  beforeEach(async () => {
    owner = await createTestOwner();
    hostel = await createTestHostel(owner.id);
    room = await createTestRoom(hostel.id);
    tenant = await createTestTenant(owner.id, hostel.id, { security_deposit: 5000 });
    await allocateTestRoom(tenant.id, room.id, { hostel_id: hostel.id });
  });

  it('pass-through fields are byte-identical to direct getTenantDues()/getBalance() calls', async () => {
    await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'PENDING',
      due_date: daysFromNow(-10), rent_month: daysFromNow(-10),
    });
    await prisma.tenant_financial_ledger.create({
      data: {
        id: uuidv4(),
        tenant_id: tenant.id,
        owner_id: owner.id,
        hostel_id: hostel.id,
        type: 'CREDIT',
        reason: 'FUTURE_RENT_CREDIT_TOPUP',
        amount: 6000,
        balance_after: 6000,
        created_by: owner.id,
      },
    });

    const [dues, balance, readModel] = await Promise.all([
      financialService.getTenantDues(tenant.id, owner.id, hostel.id),
      tenantFinancialLedgerService.getBalance(tenant.id, owner.id),
      financialReadModelService.getFinancialReadModel(tenant.id, owner.id, hostel.id),
    ]);

    expect(readModel.total_due).toBe(dues.total_due);
    expect(readModel.current_payable_amount).toBe(dues.current_payable_amount);
    expect(readModel.overdue_amount).toBe(dues.overdue_amount);
    expect(readModel.upcoming_amount).toBe(dues.upcoming_amount);
    expect(readModel.rent_due).toBe(dues.rent_due);
    expect(readModel.obligation_count).toBe(dues.obligation_count);

    expect(readModel.future_rent_credit).toBe(balance.future_rent_credit);
    expect(readModel.ledger_balance).toBe(balance.balance);
    expect(readModel.security_deposit.configured).toBe(balance.security_deposit);
    expect(readModel.security_deposit.paid).toBe(balance.security_deposit_paid);
  });

  it('excludes UPCOMING from overdue/current-payable, and correctly classifies an overdue partial obligation', async () => {
    const paidOb = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'PAID',
      due_date: daysFromNow(-60), rent_month: daysFromNow(-60),
    });
    await createTestPayment(paidOb.id, 8000);

    const overdueOb = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'PARTIAL',
      due_date: daysFromNow(-10), rent_month: daysFromNow(-10),
    });
    await createTestPayment(overdueOb.id, 3000);

    await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'UPCOMING',
      due_date: daysFromNow(20), rent_month: daysFromNow(20),
    });

    const readModel = await financialReadModelService.getFinancialReadModel(tenant.id, owner.id, hostel.id);

    // Paid obligation excluded entirely (matches getTenantDues() semantics).
    expect(readModel.items.find((i) => i.obligation_id === paidOb.id)).toBeUndefined();

    // Only the overdue partial obligation counts toward overdue_amount.
    expect(readModel.overdue_amount).toBe(5000);
    expect(readModel.current_payable_amount).toBe(5000);
    expect(readModel.upcoming_amount).toBe(8000);
    expect(readModel.total_due).toBe(13000);

    const overdueItem = readModel.items.find((i) => i.obligation_id === overdueOb.id);
    expect(overdueItem).toBeDefined();
    expect(overdueItem!.is_overdue).toBe(true);
    expect(overdueItem!.overdue_days).toBeGreaterThanOrEqual(10);
    expect(overdueItem!.outstanding).toBe(5000);

    expect(readModel.overdue_obligation_count).toBe(1);
    expect(readModel.overdue_days).toBeGreaterThanOrEqual(10);
    expect(readModel.payment_status).toBe('OVERDUE');

    // Regression for the "Rent due ₹93,500 instead of ₹8,500" bug: rent_due
    // (pass-through) includes the UPCOMING obligation, but
    // current_payable_breakdown must not — it should match overdue_amount.
    expect(readModel.rent_due).toBe(13000);
    expect(readModel.current_payable_breakdown.rent).toBe(5000);
    expect(readModel.current_payable_breakdown.rent).toBe(readModel.current_payable_amount);
  });

  it('tenant self-service entry point (getFinancialReadModelForTenant) agrees with the owner entry point', async () => {
    await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'PENDING',
      due_date: daysFromNow(-5), rent_month: daysFromNow(-5),
    });

    const ownerModel = await financialReadModelService.getFinancialReadModel(tenant.id, owner.id, hostel.id);
    const tenantModel = await financialReadModelService.getFinancialReadModelForTenant(tenant.profile_id);

    expect(tenantModel.overdue_amount).toBe(ownerModel.overdue_amount);
    expect(tenantModel.current_payable_amount).toBe(ownerModel.current_payable_amount);
    expect(tenantModel.total_due).toBe(ownerModel.total_due);
    expect(tenantModel.future_rent_credit).toBe(ownerModel.future_rent_credit);
    expect(tenantModel.payment_status).toBe(ownerModel.payment_status);
  });

  it('returns NOT_GENERATED / PAID states correctly with no outstanding obligations', async () => {
    const readModel = await financialReadModelService.getFinancialReadModel(tenant.id, owner.id, hostel.id);
    expect(readModel.obligation_count).toBe(0);
    expect(readModel.payment_status).toBe('NOT_GENERATED');

    const paidOb = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'PAID',
      due_date: daysFromNow(-5), rent_month: daysFromNow(-5),
    });
    await createTestPayment(paidOb.id, 8000);

    const readModel2 = await financialReadModelService.getFinancialReadModel(tenant.id, owner.id, hostel.id);
    // getTenantDues() excludes fully-paid obligations, so obligation_count stays 0
    // and payment_status remains NOT_GENERATED (no *currently outstanding* obligations) —
    // this matches getTenantDues()'s documented "does not include PAID obligations" contract.
    expect(readModel2.obligation_count).toBe(0);
    expect(readModel2.payment_status).toBe('NOT_GENERATED');
  });
});
