import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/payments/dues/route';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant, allocateTestRoom } from '../factories/tenant-factory';
import { createTestRoom } from '../factories/room-factory';
import { createTestObligation, createTestPayment } from '../factories/payment-factory';
import { authService } from '@/lib/services/auth-service';
import { prisma } from '@/lib/db';

vi.mock('@/lib/services/auth-service', () => {
  return {
    authService: {
      getCurrentUser: vi.fn(),
    },
  };
});

describe('Payments API - /api/payments/dues', () => {
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

  it('should return 401 if unauthorized', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/payments/dues');
    const res = await GET(req);
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('should return 400 if hostelId is missing', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue({
      id: owner.id,
      role: 'OWNER',
      email: owner.email,
    } as any);
    const req = new NextRequest('http://localhost/api/payments/dues');
    const res = await GET(req);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.code).toBe('HOSTEL_CONTEXT_REQUIRED');
  });

  it('should calculate dues correctly for a tenant with unpaid obligations', async () => {
    // Create an obligation of 10000 with 2000 paid -> 8000 outstanding
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, { amount: 10000 });
    await createTestPayment(obligation.id, 2000);

    vi.mocked(authService.getCurrentUser).mockResolvedValue({
      id: owner.id,
      role: 'OWNER',
      email: owner.email,
    } as any);

    const req = new NextRequest(`http://localhost/api/payments/dues?hostelId=${hostel.id}`);
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    const data = json.data;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0].amount).toBe(10000);
    expect(data[0].outstanding).toBe(8000);
  });
});
