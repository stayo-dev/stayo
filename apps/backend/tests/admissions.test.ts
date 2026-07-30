import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => {
  return {
    mockPrisma: {
      rooms: {
        findMany: vi.fn(),
      },
      visitorLead: {
        count: vi.fn(),
        groupBy: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      leadActivity: {
        count: vi.fn(),
        groupBy: vi.fn(),
        findMany: vi.fn(),
      },
      roomReservation: {
        count: vi.fn(),
        findMany: vi.fn(),
      },
      tenants: {
        findMany: vi.fn(),
      },
      tenant_financial_ledger: {
        groupBy: vi.fn(),
      },
      rent_obligations: {
        findMany: vi.fn(),
      },
    }
  };
});

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
  supabase: {},
}));

vi.mock('@/lib/redis/cache', () => ({
  getOrSetJson: vi.fn((key, ttl, cb) => cb()),
  invalidateTag: vi.fn(),
}));

vi.mock('@/lib/redis/rate-limit', () => ({
  checkFixedWindowLimit: vi.fn(),
}));

import { AdmissionsService } from '@/src/services/admissions/admissions-service';

describe('AdmissionsService analytical boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('instantiates correctly and defines expected public methods', () => {
    const service = new AdmissionsService();
    expect(service).toBeDefined();
    expect(service.analytics).toBeDefined();
    expect(service.createDirectLead).toBeDefined();
    expect(service.updateStatus).toBeDefined();
  });

  it('computes unified onboarding funnel metrics based on computed reservation state', async () => {
    // 1. Setup mock data for active rooms, visitor leads, activities, etc. to prevent null pointer exceptions
    mockPrisma.rooms.findMany.mockResolvedValue([
      { id: 'room-1', room_no: '101', capacity: 2, base_rent: 8000, room_allocations: [], hostels: { name: 'Hostel A' } },
    ]);
    mockPrisma.visitorLead.findMany.mockResolvedValue([]);
    mockPrisma.leadActivity.findMany.mockResolvedValue([]);
    mockPrisma.leadActivity.groupBy.mockResolvedValue([]);
    mockPrisma.roomReservation.findMany.mockResolvedValue([]);
    mockPrisma.leadActivity.count.mockResolvedValue(0);
    mockPrisma.visitorLead.count.mockResolvedValue(0);
    mockPrisma.visitorLead.groupBy.mockResolvedValue([]);
    mockPrisma.visitorLead.findFirst.mockResolvedValue(null);

    // 2. Setup mock tenants for onboarding funnel calculation:
    // Tenant 1: status = INVITED
    // Tenant 2: status = ACTIVE (PAST DEPOSIT cleared, maintenance cleared -> MOVED_IN)
    // Tenant 3: status = ACTIVE (PARTIAL_DEPOSIT policy, deposit paid >= min threshold, maintenance paid -> RESERVED)
    // Tenant 4: status = ACTIVE (deposit unpaid -> PAYMENT_PENDING)
    mockPrisma.tenants.findMany.mockResolvedValue([
      {
        id: 't-1',
        status: 'INVITED',
        security_deposit: 10000,
        maintenance_charge: 1000,
        maintenance_type: 'ONE_TIME',
        reservation_policy: 'FULL_DEPOSIT',
        minimum_reservation_deposit: 0,
      },
      {
        id: 't-2',
        status: 'ACTIVE',
        security_deposit: 10000,
        maintenance_charge: 1000,
        maintenance_type: 'ONE_TIME',
        reservation_policy: 'FULL_DEPOSIT',
        minimum_reservation_deposit: 0,
      },
      {
        id: 't-3',
        status: 'ACTIVE',
        security_deposit: 10000,
        maintenance_charge: 1000,
        maintenance_type: 'ONE_TIME',
        reservation_policy: 'PARTIAL_DEPOSIT',
        minimum_reservation_deposit: 5000,
      },
      {
        id: 't-4',
        status: 'ACTIVE',
        security_deposit: 10000,
        maintenance_charge: 1000,
        maintenance_type: 'ONE_TIME',
        reservation_policy: 'FULL_DEPOSIT',
        minimum_reservation_deposit: 0,
      },
    ]);

    // Setup ledger advance deposits group by:
    // t-2: paid 10000
    // t-3: paid 5000
    // t-4: paid 0
    mockPrisma.tenant_financial_ledger.groupBy.mockResolvedValue([
      { tenant_id: 't-2', _sum: { amount: 10000 } },
      { tenant_id: 't-3', _sum: { amount: 5000 } },
    ]);

    // Setup rent obligations/maintenance payments:
    // t-2: maintenance paid 1000
    // t-3: maintenance paid 1000
    // t-4: maintenance paid 0
    mockPrisma.rent_obligations.findMany.mockResolvedValue([
      { tenant_id: 't-2', obligation_type: 'MAINTENANCE', payments: [{ amount_paid: 1000 }] },
      { tenant_id: 't-3', obligation_type: 'MAINTENANCE', payments: [{ amount_paid: 1000 }] },
    ]);

    const service = new AdmissionsService();
    const result = await service.analytics('owner-1', { hostelId: 'hostel-1' });

    expect(result.funnel).toBeDefined();
    expect(result.funnel.invited).toBe(1); // t-1
    expect(result.funnel.activated).toBe(3); // t-2, t-3, t-4 (status = ACTIVE)
    expect(result.funnel.payment_pending).toBe(1); // t-4
    expect(result.funnel.reserved).toBe(1); // t-3
    expect(result.funnel.moved_in).toBe(1); // t-2
    expect(result.funnel.joined).toBe(1); // alias for moved_in
  });
});
