import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("counts a joined tenant who has paid nothing as occupying their bed", async () => {
    // The occupancy count used to consult each tenant's deposit and skip anyone
    // still `PAYMENT_PENDING`, so an unpaid tenant who had already moved in left
    // their bed looking vacant — and invitable to somebody else. The db mock here
    // supplies no ledger, payment or obligation data at all: if occupancy still
    // depended on money, this call could not produce 3.
    const db = createDb(0);
    const snapshot = await service.getRoomCapacitySnapshot("room-1", { tx: db as any });

    expect(snapshot.occupied).toBe(3);
    expect(db.roomAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          room_id: "room-1",
          is_active: true,
          end_date: null,
          tenant: { status: "ACTIVE" },
        }),
      })
    );
  });
});
