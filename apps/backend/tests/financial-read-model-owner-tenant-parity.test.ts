import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { authService } from '@/lib/services/auth-service';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from './factories/owner-factory';
import { createTestTenant, allocateTestRoom } from './factories/tenant-factory';
import { createTestRoom } from './factories/room-factory';
import { createTestObligation, createTestPayment } from './factories/payment-factory';
import { GET as getOwnerOverview } from '@/app/api/tenants/owner/tenants/[id]/overview/route';
import { GET as getTenantReadModel } from '@/app/api/tenants/me/financial-read-model/route';
import { GET as getTenantDues } from '@/app/api/payments/tenant-dues/route';

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, getSession: vi.fn() };
});

vi.mock('@/lib/services/auth-service', () => ({
  authService: { getCurrentUser: vi.fn() },
}));

/**
 * The core regression from docs/business-logic/financial-consistency-investigation-report.md:
 * owner and tenant screens must show identical Outstanding/Overdue/Future
 * Credit for the same tenant. This hits the real HTTP route handlers (owner
 * overview + tenant self-service financial-read-model), not just the
 * underlying service, so it proves the routes agree end-to-end.
 */
describe('Owner vs tenant financial parity across real routes', () => {
  let owner: any;
  let hostel: any;
  let tenant: any;
  let room: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    owner = await createTestOwner();
    hostel = await createTestHostel(owner.id);
    room = await createTestRoom(hostel.id);
    tenant = await createTestTenant(owner.id, hostel.id, { security_deposit: 5000 });
    await allocateTestRoom(tenant.id, room.id, { hostel_id: hostel.id });
  });

  it('owner overview and tenant financial-read-model report identical outstanding/overdue/future-credit', async () => {
    const overdueOb = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'PARTIAL',
      due_date: new Date(Date.now() - 10 * 86_400_000),
      rent_month: new Date(Date.now() - 10 * 86_400_000),
    });
    await createTestPayment(overdueOb.id, 2000);

    await prisma.tenant_financial_ledger.create({
      data: {
        id: crypto.randomUUID(),
        tenant_id: tenant.id,
        owner_id: owner.id,
        hostel_id: hostel.id,
        type: 'CREDIT',
        reason: 'FUTURE_RENT_CREDIT_TOPUP',
        amount: 3000,
        balance_after: 3000,
        created_by: owner.id,
      },
    });

    vi.mocked(getSession).mockResolvedValue({
      sub: owner.id,
      owner_id: owner.id,
      role: 'OWNER',
      email: owner.email,
    } as any);
    const ownerReq = new NextRequest(`http://localhost/api/tenants/owner/tenants/${tenant.id}/overview`);
    const ownerRes = await getOwnerOverview(ownerReq, { params: { id: tenant.id } });
    const ownerJson = await ownerRes.json();
    expect(ownerRes.status).toBe(200);

    vi.mocked(getSession).mockResolvedValue({
      sub: tenant.profile_id,
      role: 'TENANT',
      email: 'tenant@example.com',
    } as any);
    const tenantReq = new NextRequest('http://localhost/api/tenants/me/financial-read-model');
    const tenantRes = await getTenantReadModel(tenantReq);
    const tenantJson = await tenantRes.json();
    expect(tenantRes.status).toBe(200);

    // apiResponse() from @/lib/auth spreads a plain-object payload flat
    // ({success: true, ...data}), not nested under a `.data` key.
    expect(ownerJson.overdue_amount).toBe(tenantJson.overdue_amount);
    expect(ownerJson.current_payable_amount).toBe(tenantJson.current_payable_amount);
    expect(ownerJson.outstanding).toBe(tenantJson.total_due);
    expect(ownerJson.advance_balance).toBe(tenantJson.future_rent_credit);
    expect(ownerJson.advance_balance).toBe(3000);
    expect(ownerJson.overdue_amount).toBe(6000);
  });

  it('owner-scoped and tenant-scoped GET /api/payments/tenant-dues agree on total_due/overdue_amount', async () => {
    await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'PENDING',
      due_date: new Date(Date.now() - 5 * 86_400_000),
      rent_month: new Date(Date.now() - 5 * 86_400_000),
    });

    vi.mocked(authService.getCurrentUser).mockResolvedValue({
      id: owner.id,
      role: 'OWNER',
      email: owner.email,
    } as any);
    const ownerReq = new NextRequest(`http://localhost/api/payments/tenant-dues?tenant_id=${tenant.id}&hostelId=${hostel.id}`);
    const ownerRes = await getTenantDues(ownerReq);
    const ownerJson = await ownerRes.json();
    expect(ownerRes.status).toBe(200);

    vi.mocked(authService.getCurrentUser).mockResolvedValue({
      id: tenant.profile_id,
      role: 'TENANT',
      email: 'tenant@example.com',
    } as any);
    const tenantReq = new NextRequest(`http://localhost/api/payments/tenant-dues?tenant_id=${tenant.id}`);
    const tenantRes = await getTenantDues(tenantReq);
    const tenantJson = await tenantRes.json();
    expect(tenantRes.status).toBe(200);

    expect(ownerJson.data.total_due).toBe(tenantJson.data.total_due);
    expect(ownerJson.data.overdue_amount).toBe(tenantJson.data.overdue_amount);
  });
});
