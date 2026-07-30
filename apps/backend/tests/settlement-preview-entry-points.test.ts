import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import { createTestOwner, createTestHostel } from './factories/owner-factory';
import { createTestTenant, allocateTestRoom } from './factories/tenant-factory';
import { createTestRoom } from './factories/room-factory';
import { createTestObligation } from './factories/payment-factory';
import { GET as settlementPreview } from '@/app/api/payments/settlement-preview/route';

vi.mock('@/lib/services/auth-service', () => ({
  authService: { getCurrentUser: vi.fn() },
}));

/**
 * Proves the RecordPaymentModal.tsx Settlement Preview fix is meaningful,
 * not a no-op: GET /api/payments/settlement-preview already supports
 * allowed_obligation_ids (obligation-scoped collect flows), and scoping it
 * to one obligation genuinely changes the returned plan rather than always
 * allocating across everything outstanding.
 */
describe('Settlement Preview — allowed_obligation_ids scoping (obligation-scoped Collect entry points)', () => {
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

    vi.mocked(authService.getCurrentUser).mockResolvedValue({
      id: owner.id,
      role: 'OWNER',
      email: owner.email,
    } as any);
  });

  it('unscoped preview allocates across both outstanding obligations, oldest first', async () => {
    await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'PENDING',
      due_date: new Date(Date.now() - 40 * 86_400_000), rent_month: new Date(Date.now() - 40 * 86_400_000),
    });
    await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'PENDING',
      due_date: new Date(Date.now() - 10 * 86_400_000), rent_month: new Date(Date.now() - 10 * 86_400_000),
    });

    const req = new NextRequest(`http://localhost/api/payments/settlement-preview?tenant_id=${tenant.id}&amount=16000&hostelId=${hostel.id}`);
    const res = await settlementPreview(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    const activeAllocations = json.allocations.filter((a: any) => a.allocated > 0);
    expect(activeAllocations.length).toBe(2);
  });

  it('scoping to a single obligation (as the fixed obligation-scoped Collect flow now does) only allocates to that one', async () => {
    const older = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'PENDING',
      due_date: new Date(Date.now() - 40 * 86_400_000), rent_month: new Date(Date.now() - 40 * 86_400_000),
    });
    const newer = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'PENDING',
      due_date: new Date(Date.now() - 10 * 86_400_000), rent_month: new Date(Date.now() - 10 * 86_400_000),
    });

    const req = new NextRequest(
      `http://localhost/api/payments/settlement-preview?tenant_id=${tenant.id}&amount=8000&hostelId=${hostel.id}&allowed_obligation_ids=${newer.id}`,
    );
    const res = await settlementPreview(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    const activeAllocations = json.allocations.filter((a: any) => a.allocated > 0);
    expect(activeAllocations.length).toBe(1);
    expect(activeAllocations[0].obligation_id).toBe(newer.id);
    void older;
  });
});
