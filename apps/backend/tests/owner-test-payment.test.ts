import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/payments/test-intent/route';
import { createTestOwner, createTestHostel } from './factories/owner-factory';
import { createTestTenant, allocateTestRoom } from './factories/tenant-factory';
import { createTestRoom } from './factories/room-factory';
import { authService } from '@/lib/services/auth-service';
import { prisma } from '@/lib/db';
import axios from 'axios';

vi.mock('axios');
vi.mock('@/lib/services/auth-service', () => {
  return {
    authService: {
      getCurrentUser: vi.fn(),
    },
  };
});

describe('Owner Test Payment API - /api/payments/test-intent', () => {
  let owner: any;
  let hostel: any;
  let tenant: any;
  let room: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    owner = await createTestOwner();
    hostel = await createTestHostel(owner.id);
    room = await createTestRoom(hostel.id);
    tenant = await createTestTenant(owner.id, hostel.id);
    await allocateTestRoom(tenant.id, room.id, { hostel_id: hostel.id });

    // Mock environment credentials for Razorpay (the active provider in tests)
    process.env.PAYMENT_PROVIDER = 'RAZORPAY';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_webhook_secret';

    vi.mocked(axios.post).mockImplementation(async () => ({
      data: {
        id: `order_mock_${Math.random().toString(36).substring(2, 10)}`,
        entity: 'order',
        amount: 100,
        currency: 'INR',
        receipt: 'txn_receipt_001',
        status: 'created',
      },
    }));
  });

  it('should return 401 if unauthorized', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/payments/test-intent', {
      method: 'POST',
      body: JSON.stringify({ tenant_id: tenant.id, hostel_id: hostel.id, amount: 1 }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('should successfully create a ₹1 test payment intent for the tenant', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue({
      id: owner.id,
      role: 'OWNER',
      email: owner.email,
    } as any);

    const req = new NextRequest('http://localhost/api/payments/test-intent', {
      method: 'POST',
      body: JSON.stringify({
        tenant_id: tenant.id,
        hostelId: hostel.id,
        amount: 1,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(Number(json.obligation.amount)).toBe(1);
    expect(json.obligation.obligation_type).toBe('EXTRA_CHARGE');
    expect(Number(json.attempt.amount)).toBe(1);
    expect(json.attempt.payment_type).toBe('RENT'); // Multi-obligation is default RENT
  });

  it('should fail if the amount is outside the allowed ₹1 to ₹100 range', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue({
      id: owner.id,
      role: 'OWNER',
      email: owner.email,
    } as any);

    const req = new NextRequest('http://localhost/api/payments/test-intent', {
      method: 'POST',
      body: JSON.stringify({
        tenant_id: tenant.id,
        hostelId: hostel.id,
        amount: 250, // More than 100
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.message).toContain('Test payment amount must be between ₹1 and ₹100');
  });

  it('should successfully create a ₹1 test payment intent when logged in as a TENANT in non-production environment', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue({
      id: tenant.profile_id,
      role: 'TENANT',
      email: 'tenant@example.com',
    } as any);

    const req = new NextRequest('http://localhost/api/payments/test-intent', {
      method: 'POST',
      body: JSON.stringify({
        amount: 1,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(Number(json.obligation.amount)).toBe(1);
    expect(json.obligation.obligation_type).toBe('EXTRA_CHARGE');
    expect(Number(json.attempt.amount)).toBe(1);
  });

  it('should reject test payment intent creation if logged in as TENANT in production environment', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      vi.mocked(authService.getCurrentUser).mockResolvedValue({
        id: tenant.profile_id,
        role: 'TENANT',
        email: 'tenant@example.com',
      } as any);

      const req = new NextRequest('http://localhost/api/payments/test-intent', {
        method: 'POST',
        body: JSON.stringify({
          amount: 1,
        }),
      });

      const res = await POST(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error.code).toBe('FORBIDDEN');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
}, 30000);
