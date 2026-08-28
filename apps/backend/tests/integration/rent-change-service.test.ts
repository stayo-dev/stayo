import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant, createTestAgreement } from '../factories/tenant-factory';
import { createTestPayment } from '../factories/payment-factory';
import { applyRentChangeInTx } from '@/src/services/payments/rent-change-service';

async function createFutureRentObligation(tx: any, tenantId: string, hostelId: string, agreementId: string, rentMonth: Date, amount: number, overrides: any = {}) {
  return tx.rent_obligations.create({
    data: {
      tenant_id: tenantId,
      hostel_id: hostelId,
      agreement_id: agreementId,
      obligation_type: 'RENT',
      amount,
      total_amount: amount,
      rent_month: rentMonth,
      due_date: new Date(rentMonth.getTime() + 4 * 24 * 60 * 60 * 1000),
      status: 'UPCOMING',
      lifecycle_status: 'ACTIVE',
      settlement_status: 'UNPAID',
      ...overrides,
    },
  });
}

describe('applyRentChangeInTx', () => {
  it('reprices future zero-payment obligations from the chosen month onward, leaves earlier months untouched', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const agreement = await createTestAgreement(tenant.id, hostel.id, { contract_rent: 8000 });

    const jan = new Date(Date.UTC(2027, 0, 1));
    const feb = new Date(Date.UTC(2027, 1, 1));
    const mar = new Date(Date.UTC(2027, 2, 1));

    const janObligation = await prisma.$transaction((tx) => createFutureRentObligation(tx, tenant.id, hostel.id, agreement.id, jan, 8000));
    const febObligation = await prisma.$transaction((tx) => createFutureRentObligation(tx, tenant.id, hostel.id, agreement.id, feb, 8000));
    const marObligation = await prisma.$transaction((tx) => createFutureRentObligation(tx, tenant.id, hostel.id, agreement.id, mar, 8000));

    const result = await prisma.$transaction((tx) =>
      applyRentChangeInTx(tx, {
        tenantId: tenant.id,
        hostelId: hostel.id,
        newRentAmount: 9000,
        effectiveFromMonth: feb,
        actorId: owner.id,
        reason: 'annual increment',
      })
    );

    expect(result.obligationsUpdated).toBe(2);
    expect(result.updatedObligationIds.sort()).toEqual([febObligation.id, marObligation.id].sort());
    expect(result.oldRentAmount).toBe(8000);
    expect(result.newRentAmount).toBe(9000);

    const untouchedJan = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: janObligation.id } });
    expect(Number(untouchedJan.amount)).toBe(8000);

    const repricedFeb = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: febObligation.id } });
    expect(Number(repricedFeb.amount)).toBe(9000);
    expect(Number(repricedFeb.total_amount)).toBe(9000);

    const repricedMar = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: marObligation.id } });
    expect(Number(repricedMar.amount)).toBe(9000);

    const updatedAgreement = await prisma.agreement.findUniqueOrThrow({ where: { id: agreement.id } });
    expect(Number(updatedAgreement.contract_rent)).toBe(9000);

    const updatedTenant = await prisma.tenants.findUniqueOrThrow({ where: { id: tenant.id } });
    expect(Number(updatedTenant.monthly_rent)).toBe(9000);
  });

  it('never touches an obligation that already has a payment, even if its rent_month is in scope', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const agreement = await createTestAgreement(tenant.id, hostel.id, { contract_rent: 8000 });

    const feb = new Date(Date.UTC(2027, 1, 1));
    const paidFebObligation = await prisma.$transaction((tx) => createFutureRentObligation(tx, tenant.id, hostel.id, agreement.id, feb, 8000));
    await createTestPayment(paidFebObligation.id, 8000);

    const result = await prisma.$transaction((tx) =>
      applyRentChangeInTx(tx, {
        tenantId: tenant.id,
        hostelId: hostel.id,
        newRentAmount: 9000,
        effectiveFromMonth: feb,
        actorId: owner.id,
        reason: 'increment',
      })
    );

    expect(result.obligationsUpdated).toBe(0);
    const untouched = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: paidFebObligation.id } });
    expect(Number(untouched.amount)).toBe(8000);
  });

  it('changes rent for a tenant with no agreement at all', async () => {
    // The case the agreement-anchored version could not serve: a hostel with
    // `agreement_required = false` never signs, so no Agreement row is ever
    // created, and rent still has to be changeable.
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id, { monthly_rent: 8000 });

    const feb = new Date(Date.UTC(2027, 1, 1));
    const obligation = await prisma.$transaction((tx: any) =>
      tx.rent_obligations.create({
        data: {
          tenant_id: tenant.id,
          hostel_id: hostel.id,
          obligation_type: 'RENT',
          amount: 8000,
          total_amount: 8000,
          rent_month: feb,
          due_date: new Date(feb.getTime() + 4 * 24 * 60 * 60 * 1000),
          status: 'UPCOMING',
          lifecycle_status: 'ACTIVE',
          settlement_status: 'UNPAID',
        },
      })
    );

    const result = await prisma.$transaction((tx: any) =>
      applyRentChangeInTx(tx, {
        tenantId: tenant.id,
        hostelId: hostel.id,
        newRentAmount: 9000,
        effectiveFromMonth: feb,
        actorId: owner.id,
        reason: 'no agreement in this hostel',
      })
    );

    expect(result.agreementId).toBeNull();
    expect(result.oldRentAmount).toBe(8000);
    expect(result.obligationsUpdated).toBe(1);

    const repriced = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: obligation.id } });
    expect(Number(repriced.amount)).toBe(9000);

    const updatedTenant = await prisma.tenants.findUniqueOrThrow({ where: { id: tenant.id } });
    expect(Number(updatedTenant.monthly_rent)).toBe(9000);
  });

  it('rejects a hostel mismatch', async () => {
    const owner = await createTestOwner();
    const hostelA = await createTestHostel(owner.id);
    const hostelB = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostelA.id);

    await expect(
      prisma.$transaction((tx) =>
        applyRentChangeInTx(tx, {
          tenantId: tenant.id,
          hostelId: hostelB.id,
          newRentAmount: 9000,
          effectiveFromMonth: new Date(Date.UTC(2027, 1, 1)),
          actorId: owner.id,
          reason: 'test',
        })
      )
    ).rejects.toThrow(/hostel/i);
  });
});
