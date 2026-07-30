import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant } from '../factories/tenant-factory';
import { createTestObligation } from '../factories/payment-factory';
import { PaymentLinkService } from '@/src/services/payments/payment-link-service';

describe('PaymentLinkService.getOrCreateToken', () => {
  it('creates a real payment_link_tokens row for an obligation without a Prisma invocation error', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, { amount: 8000, status: 'PENDING' });

    const result = await PaymentLinkService.getOrCreateToken({ obligationId: obligation.id });

    expect(result.token).toBeTruthy();
    expect(result.expiresAt).toBeInstanceOf(Date);

    const row = await prisma.payment_link_tokens.findUniqueOrThrow({ where: { token: result.token } });
    expect(row.obligation_id).toBe(obligation.id);
    expect(row.tenant_id).toBe(tenant.id);
    expect(row.hostel_id).toBe(hostel.id);
  });

  it('creates a tenant-scoped token (obligation_id stays null) even when tenant has outstanding obligations', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000,
      status: 'PENDING',
      billing_period_start: new Date(Date.UTC(2027, 0, 1)),
    });

    const result = await PaymentLinkService.getOrCreateToken({ tenantId: tenant.id });

    const row = await prisma.payment_link_tokens.findUniqueOrThrow({ where: { token: result.token } });
    expect(row.tenant_id).toBe(tenant.id);
    expect(row.hostel_id).toBe(hostel.id);
    expect(row.obligation_id).toBeNull();
  });

  it('reuses an existing non-expired token instead of creating a duplicate', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, { amount: 8000, status: 'PENDING' });

    const first = await PaymentLinkService.getOrCreateToken({ obligationId: obligation.id });
    const second = await PaymentLinkService.getOrCreateToken({ obligationId: obligation.id });

    expect(second.token).toBe(first.token);

    const count = await prisma.payment_link_tokens.count({ where: { obligation_id: obligation.id } });
    expect(count).toBe(1);
  });

  it('creates a tenant-scoped token even when the tenant has no outstanding obligations', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    // Deliberately no createTestObligation call — tenant has zero obligations.

    const result = await PaymentLinkService.getOrCreateToken({ tenantId: tenant.id });

    const row = await prisma.payment_link_tokens.findUniqueOrThrow({ where: { token: result.token } });
    expect(row.tenant_id).toBe(tenant.id);
    expect(row.hostel_id).toBe(hostel.id);
    expect(row.obligation_id).toBeNull();
  });

  it('reuses an existing non-expired tenant-scoped token instead of creating a new one', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);

    const first = await PaymentLinkService.getOrCreateToken({ tenantId: tenant.id });
    const second = await PaymentLinkService.getOrCreateToken({ tenantId: tenant.id });

    expect(second.token).toBe(first.token);
  });

  it('throws a clear error when tenant has no associated owner', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id, { owner_id: null });

    await expect(
      PaymentLinkService.getOrCreateToken({ tenantId: tenant.id })
    ).rejects.toThrow(/owner/i);
  });
});
