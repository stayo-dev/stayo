import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createCase, GET as listCases } from '@/app/api/recovery/cases/route';
import { GET as getCase } from '@/app/api/recovery/cases/[id]/route';
import { POST as validateCase } from '@/app/api/recovery/cases/[id]/validate/route';
import { POST as executeCase } from '@/app/api/recovery/cases/[id]/execute/route';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant } from '../factories/tenant-factory';
import { createTestObligation, createTestPayment } from '../factories/payment-factory';

// `getSession` (backend-next/lib/auth.ts) reads plain headers set by
// middleware in production. Since ADR-031 it's dual-mode: `x-auth-mode:
// legacy` selects the pre-Supabase header shape below (x-user-id /
// x-user-role / x-owner-id / x-tenant-id); without that header getSession()
// returns null regardless of what else is set. Route-level integration
// tests that call handlers directly (bypassing middleware) set those
// headers on the NextRequest themselves — see
// tests/integration/runtime-verification-audit.test.ts for the established
// pattern. No auth-service or getSession mocking is needed or correct here.
function ownerHeaders(ownerId: string) {
  return {
    'x-auth-mode': 'legacy',
    'x-user-id': ownerId,
    'x-user-role': 'OWNER',
    'x-owner-id': ownerId,
  };
}

describe('Recovery API routes', () => {
  it('creates, validates, and executes a PAYMENT_REVERSAL case end to end over HTTP handlers', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, { amount: 4000 });
    const payment = await createTestPayment(obligation.id, 4000);

    const createReq = new NextRequest('http://localhost/api/recovery/cases', {
      method: 'POST',
      body: JSON.stringify({
        hostelId: hostel.id,
        caseType: 'PAYMENT_REVERSAL',
        reason: 'api test reversal',
        input: { paymentId: payment.id },
      }),
      headers: ownerHeaders(owner.id),
    });
    const createRes = await createCase(createReq);
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()).data;
    expect(created.status).toBe('PREVIEW'); // route combines create+preview

    const validateReq = new NextRequest(`http://localhost/api/recovery/cases/${created.id}/validate`, {
      method: 'POST',
      headers: ownerHeaders(owner.id),
    });
    const validateRes = await validateCase(validateReq, { params: { id: created.id } });
    expect(validateRes.status).toBe(200);

    const executeReq = new NextRequest(`http://localhost/api/recovery/cases/${created.id}/execute`, {
      method: 'POST',
      headers: ownerHeaders(owner.id),
    });
    const executeRes = await executeCase(executeReq, { params: { id: created.id } });
    expect(executeRes.status).toBe(200);
    const executed = (await executeRes.json()).data;
    expect(executed.status).toBe('COMPLETED');

    const getReq = new NextRequest(`http://localhost/api/recovery/cases/${created.id}?hostelId=${hostel.id}`, {
      headers: ownerHeaders(owner.id),
    });
    const getRes = await getCase(getReq, { params: { id: created.id } });
    const detail = (await getRes.json()).data;
    expect(detail.status).toBe('COMPLETED');
    expect(Array.isArray(detail.events)).toBe(true);
    expect(detail.events.length).toBeGreaterThan(0);

    const listReq = new NextRequest(`http://localhost/api/recovery/cases?hostelId=${hostel.id}`, {
      headers: ownerHeaders(owner.id),
    });
    const listRes = await listCases(listReq);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()).data;
    expect(list.some((c: any) => c.id === created.id)).toBe(true);
  });

  it('rejects unauthenticated requests', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);

    const req = new NextRequest(`http://localhost/api/recovery/cases?hostelId=${hostel.id}`);
    const res = await listCases(req);
    expect(res.status).toBe(401);
  });

  it('rejects when the caller owner does not own the target hostel', async () => {
    const owner = await createTestOwner();
    const otherOwner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);

    const req = new NextRequest(`http://localhost/api/recovery/cases?hostelId=${hostel.id}`, {
      headers: ownerHeaders(otherOwner.id),
    });
    const res = await listCases(req);
    expect(res.status).toBe(403);
  });

  it('rejects fetching a case whose hostel does not belong to the caller', async () => {
    const owner = await createTestOwner();
    const otherOwner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, { amount: 2000 });
    const payment = await createTestPayment(obligation.id, 2000);

    const createReq = new NextRequest('http://localhost/api/recovery/cases', {
      method: 'POST',
      body: JSON.stringify({
        hostelId: hostel.id,
        caseType: 'PAYMENT_REVERSAL',
        reason: 'scoping test',
        input: { paymentId: payment.id },
      }),
      headers: ownerHeaders(owner.id),
    });
    const createRes = await createCase(createReq);
    const created = (await createRes.json()).data;

    const getReq = new NextRequest(`http://localhost/api/recovery/cases/${created.id}`, {
      headers: ownerHeaders(otherOwner.id),
    });
    const getRes = await getCase(getReq, { params: { id: created.id } });
    expect(getRes.status).toBe(403);
  });
});
