import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from './factories/owner-factory';
import { createTestTenant } from './factories/tenant-factory';

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, getSession: vi.fn() };
});

import { getSession } from '@/lib/auth';
import { POST } from '../app/api/payments/pay-link/route';

describe('POST /api/payments/pay-link — tenant self-service', () => {
  it('lets a tenant generate a link for their own account', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);

    vi.mocked(getSession).mockResolvedValue({
      role: 'TENANT',
      tenant_id: tenant.id,
      owner_id: owner.id,
    } as any);

    const req = new NextRequest('http://localhost/api/payments/pay-link', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.url).toContain('/pay/');

    const token = await prisma.payment_link_tokens.findFirst({ where: { tenant_id: tenant.id } });
    expect(token).not.toBeNull();
  });

  it('rejects a tenant trying to generate a link for a different tenant', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const otherTenant = await createTestTenant(owner.id, hostel.id);

    vi.mocked(getSession).mockResolvedValue({
      role: 'TENANT',
      tenant_id: tenant.id,
      owner_id: owner.id,
    } as any);

    const req = new NextRequest('http://localhost/api/payments/pay-link', {
      method: 'POST',
      body: JSON.stringify({ tenantId: otherTenant.id }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
  });
});
