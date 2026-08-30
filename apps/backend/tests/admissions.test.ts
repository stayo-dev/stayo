import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockPrisma, mockRoomCapacityService } = vi.hoisted(() => {
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
    },
    mockRoomCapacityService: {
      getRoomCapacitySnapshot: vi.fn(),
    },
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

// `getLeadForOwner`'s preferred-room-availability check composes this
// service rather than re-deriving capacity math — mocked wholesale so this
// file tests the composition, not room-capacity-service's own logic (that's
// `tests/room-capacity-service.test.ts`).
vi.mock('@/lib/services/room-capacity-service', () => ({
  roomCapacityService: mockRoomCapacityService,
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

describe('AdmissionsService.getLeadForOwner — room preference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function leadRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'lead-1',
      owner_id: 'owner-1',
      status: 'NEW',
      lead_score: 0,
      lead_notes: [],
      preferred_floor: null,
      preferred_room: null,
      preferred_room_id: null,
      ...overrides,
    };
  }

  it('reports the preferred room available when the capacity snapshot has a free bed', async () => {
    mockPrisma.visitorLead.findFirst.mockResolvedValueOnce(
      leadRow({
        preferred_floor: { id: 'floor-1', name: 'Ground' },
        preferred_room: { id: 'room-1', room_no: 'G101', floor_id: 'floor-1' },
        preferred_room_id: 'room-1',
      }),
    );
    mockRoomCapacityService.getRoomCapacitySnapshot.mockResolvedValueOnce({ available: 1 });

    const service = new AdmissionsService();
    const lead = await service.getLeadForOwner('lead-1', 'owner-1');

    expect(mockRoomCapacityService.getRoomCapacitySnapshot).toHaveBeenCalledWith('room-1', { ownerId: 'owner-1' });
    expect(lead.preferred_room_available).toBe(true);
  });

  it('reports the preferred room unavailable once it has filled up', async () => {
    mockPrisma.visitorLead.findFirst.mockResolvedValueOnce(
      leadRow({
        preferred_floor: { id: 'floor-1', name: 'Ground' },
        preferred_room: { id: 'room-1', room_no: 'G101', floor_id: 'floor-1' },
        preferred_room_id: 'room-1',
      }),
    );
    mockRoomCapacityService.getRoomCapacitySnapshot.mockResolvedValueOnce({ available: 0 });

    const service = new AdmissionsService();
    const lead = await service.getLeadForOwner('lead-1', 'owner-1');

    expect(lead.preferred_room_available).toBe(false);
  });

  it('reports unavailable, not an error, when the preferred room can no longer be resolved (soft-deleted)', async () => {
    mockPrisma.visitorLead.findFirst.mockResolvedValueOnce(
      leadRow({
        preferred_floor: { id: 'floor-1', name: 'Ground' },
        preferred_room: { id: 'room-1', room_no: 'G101', floor_id: 'floor-1' },
        preferred_room_id: 'room-1',
      }),
    );
    mockRoomCapacityService.getRoomCapacitySnapshot.mockRejectedValueOnce(new Error('NOT_FOUND: Room not found'));

    const service = new AdmissionsService();
    const lead = await service.getLeadForOwner('lead-1', 'owner-1');

    expect(lead.preferred_room_available).toBe(false);
  });

  it('never checks availability once the lead has already become a tenant', async () => {
    mockPrisma.visitorLead.findFirst.mockResolvedValueOnce(
      leadRow({
        status: 'JOINED',
        preferred_room: { id: 'room-1', room_no: 'G101', floor_id: 'floor-1' },
        preferred_room_id: 'room-1',
      }),
    );

    const service = new AdmissionsService();
    const lead = await service.getLeadForOwner('lead-1', 'owner-1');

    expect(mockRoomCapacityService.getRoomCapacitySnapshot).not.toHaveBeenCalled();
    expect(lead.preferred_room_available).toBeUndefined();
  });

  it('leaves preferred_room_available unset when there was no room preference', async () => {
    mockPrisma.visitorLead.findFirst.mockResolvedValueOnce(leadRow());

    const service = new AdmissionsService();
    const lead = await service.getLeadForOwner('lead-1', 'owner-1');

    expect(mockRoomCapacityService.getRoomCapacitySnapshot).not.toHaveBeenCalled();
    expect(lead.preferred_room_available).toBeUndefined();
    expect(lead.preferred_floor).toBeNull();
    expect(lead.preferred_room).toBeNull();
  });
});
