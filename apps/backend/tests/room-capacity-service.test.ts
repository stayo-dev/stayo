import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/services/tenants/reservation-status-service", () => ({
  reservationStatusService: {
    getReservationStatus: vi.fn().mockResolvedValue({ status: "MOVE_IN_READY" }),
  },
}));

import { RoomCapacityService } from "@/lib/services/room-capacity-service";

function createDb(reservedCount: number) {
  return {
    rooms: {
      findUnique: vi.fn(async () => ({
        id: "room-1",
        capacity: 4,
        is_active: true,
        hostels: { owner_id: "owner-1", status: "ACTIVE" },
      })),
    },
    roomAllocation: {
      findMany: vi.fn(async () => [
        { tenant_id: "tenant-1" },
        { tenant_id: "tenant-2" },
        { tenant_id: "tenant-3" },
      ]),
    },
    tenant_invitation_reservations: {
      count: vi.fn(async () => reservedCount),
    },
    tenant_invitations: {
      count: vi.fn(async () => reservedCount),
    },
  };
}

describe("RoomCapacityService", () => {
  let service: RoomCapacityService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RoomCapacityService();
  });

  it("counts active invitation reservations as capacity holds", async () => {
    const snapshot = await service.getRoomCapacitySnapshot("room-1", { tx: createDb(1) as any });

    expect(snapshot.occupied).toBe(3);
    expect(snapshot.reserved).toBe(1);
    expect(snapshot.used).toBe(4);
    expect(snapshot.available).toBe(0);
    expect(snapshot.state).toBe("full");
  });

  it("frees capacity after invitation reservation cancellation", async () => {
    const snapshot = await service.getRoomCapacitySnapshot("room-1", { tx: createDb(0) as any });

    expect(snapshot.occupied).toBe(3);
    expect(snapshot.reserved).toBe(0);
    expect(snapshot.used).toBe(3);
    expect(snapshot.available).toBe(1);
    expect(snapshot.state).toBe("partial");
  });
});
