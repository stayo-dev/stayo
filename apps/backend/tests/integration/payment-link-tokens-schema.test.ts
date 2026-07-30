import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant } from '../factories/tenant-factory';

describe('payment_link_tokens schema — obligation_id optional', () => {
  it('creates a token with no obligation_id', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);

    const created = await prisma.payment_link_tokens.create({
      data: {
        tenant_id: tenant.id,
        hostel_id: hostel.id,
        owner_id: owner.id,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    expect(created.obligation_id).toBeNull();

    const found = await prisma.payment_link_tokens.findUnique({
      where: { token: created.token },
      include: { rent_obligations: true },
    });
    expect(found?.rent_obligations).toBeNull();
  });
});
