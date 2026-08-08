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

  it('counts the onboarding funnel as invited then joined', async () => {
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

    // Deposits are deliberately absent from these fixtures: the funnel no longer
    // splits activated tenants by what they have paid, because joining is not
    // gated on payment. An ACTIVE tenant has joined, full stop.
    mockPrisma.tenants.findMany.mockResolvedValue([
      { id: 't-1', status: 'INVITED' },
      { id: 't-2', status: 'ACTIVE' },
      { id: 't-3', status: 'ACTIVE' },
      { id: 't-4', status: 'ACTIVE' },
    ]);

    const service = new AdmissionsService();
    const result = await service.analytics('owner-1', { hostelId: 'hostel-1' });

    expect(result.funnel).toBeDefined();
    expect(result.funnel.invited).toBe(1); // t-1
    expect(result.funnel.joined).toBe(3); // t-2, t-3, t-4
    expect(result.funnel.activated).toBe(3); // activating is joining
    expect(result.funnel.moved_in).toBe(3);
  });
});
