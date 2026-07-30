import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import { getSession } from '@/lib/auth';
import { verifyIdentityToken } from '@/lib/auth-edge';
import { POST } from '@/app/api/tenants/[id]/change-rent/route';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant, createTestAgreement } from '../factories/tenant-factory';
import { prisma } from '@/lib/db';

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, getSession: vi.fn() };
});

// Identity confirmation is a real token stored in identity_tokens. Following
// the exact pattern used elsewhere in this repo (see
// tests/quick-collect.test.ts and tests/integration/runtime-verification-audit.test.ts):
// mock verifyIdentityToken (from lib/auth-edge) to bypass real JWT signing/
// verification, but insert a REAL, unconsumed identity_tokens row so the
// route's consumeIdentityTokenInTx (a real DB update) has something genuine
// to single-use-consume.
vi.mock('@/lib/auth-edge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-edge')>();
  return { ...actual, verifyIdentityToken: vi.fn() };
});

const IDENTITY_PURPOSE = 'CHANGE_RENT';
const IDENTITY_ACTION = 'change_rent';

async function createTestIdentityToken(userId: string, jti: string = crypto.randomUUID()) {
  await prisma.identity_tokens.create({
    data: {
      jti,
      user_id: userId,
      purpose: IDENTITY_PURPOSE,
      action: IDENTITY_ACTION,
      expires_at: new Date(Date.now() + 600 * 1000),
      used: false,
    },
  });
  return jti;
}

describe('POST /api/tenants/[id]/change-rent', () => {
  it('changes rent and reprices future obligations for an authenticated owner', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const agreement = await createTestAgreement(tenant.id, hostel.id, { contract_rent: 8000 });
    const feb = new Date(Date.UTC(2027, 1, 1));
    await prisma.rent_obligations.create({
      data: {
        tenant_id: tenant.id, hostel_id: hostel.id, agreement_id: agreement.id,
        obligation_type: 'RENT', amount: 8000, total_amount: 8000, rent_month: feb,
        due_date: new Date(Date.UTC(2027, 1, 5)), status: 'UPCOMING',
        lifecycle_status: 'ACTIVE', settlement_status: 'UNPAID',
      },
    });

    vi.mocked(getSession).mockResolvedValue({
      sub: owner.id, email: owner.email, role: 'OWNER', owner_id: owner.id,
    } as any);

    const jti = crypto.randomUUID();
    await createTestIdentityToken(owner.id, jti);
    vi.mocked(verifyIdentityToken).mockResolvedValue({
      userId: owner.id, jti, action: IDENTITY_ACTION,
    });

    const req = new Request(`http://localhost/api/tenants/${tenant.id}/change-rent`, {
      method: 'POST',
      body: JSON.stringify({
        hostelId: hostel.id,
        newRentAmount: 9000,
        effectiveFromMonth: feb.toISOString(),
        reason: 'annual increment',
        identityToken: 'mock-valid-token',
      }),
    }) as any;

    const res = await POST(req, { params: { id: tenant.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.newRentAmount).toBe(9000);
    expect(body.data.obligationsUpdated).toBe(1);
  });

  it('rejects requests with no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const req = new Request('http://localhost/api/tenants/irrelevant/change-rent', { method: 'POST', body: '{}' }) as any;
    const res = await POST(req, { params: { id: 'irrelevant' } });
    expect(res.status).toBe(401);
  });

  it('rejects a missing identity token with a distinct IDENTITY_REQUIRED code', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    await createTestAgreement(tenant.id, hostel.id, { contract_rent: 8000 });

    vi.mocked(getSession).mockResolvedValue({
      sub: owner.id, email: owner.email, role: 'OWNER', owner_id: owner.id,
    } as any);

    const req = new Request(`http://localhost/api/tenants/${tenant.id}/change-rent`, {
      method: 'POST',
      body: JSON.stringify({
        hostelId: hostel.id,
        newRentAmount: 9000,
        effectiveFromMonth: new Date(Date.UTC(2027, 1, 1)).toISOString(),
        reason: 'annual increment',
        // identityToken omitted
      }),
    }) as any;

    const res = await POST(req, { params: { id: tenant.id } });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('IDENTITY_REQUIRED');
    expect(body.error.message).not.toMatch(/^IDENTITY_REQUIRED:/);
  });

  it('rejects an invalid/expired identity token with a distinct IDENTITY_EXPIRED code', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    await createTestAgreement(tenant.id, hostel.id, { contract_rent: 8000 });

    vi.mocked(getSession).mockResolvedValue({
      sub: owner.id, email: owner.email, role: 'OWNER', owner_id: owner.id,
    } as any);
    vi.mocked(verifyIdentityToken).mockResolvedValue(null);

    const req = new Request(`http://localhost/api/tenants/${tenant.id}/change-rent`, {
      method: 'POST',
      body: JSON.stringify({
        hostelId: hostel.id,
        newRentAmount: 9000,
        effectiveFromMonth: new Date(Date.UTC(2027, 1, 1)).toISOString(),
        reason: 'annual increment',
        identityToken: 'stale-token',
      }),
    }) as any;

    const res = await POST(req, { params: { id: tenant.id } });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('IDENTITY_EXPIRED');
    expect(body.error.message).not.toMatch(/^IDENTITY_EXPIRED:/);
  });

  it('rejects a hostel the caller does not own', async () => {
    const owner = await createTestOwner();
    const otherOwner = await createTestOwner();
    const otherHostel = await createTestHostel(otherOwner.id);
    const tenant = await createTestTenant(otherOwner.id, otherHostel.id);

    vi.mocked(getSession).mockResolvedValue({
      sub: owner.id, email: owner.email, role: 'OWNER', owner_id: owner.id,
    } as any);

    const req = new Request(`http://localhost/api/tenants/${tenant.id}/change-rent`, {
      method: 'POST',
      body: JSON.stringify({ hostelId: otherHostel.id, newRentAmount: 9000, effectiveFromMonth: new Date().toISOString(), reason: 'x', identityToken: 'x' }),
    }) as any;

    const res = await POST(req, { params: { id: tenant.id } });
    expect(res.status).toBe(403);
  });
});
