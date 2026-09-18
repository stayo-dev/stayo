import { beforeEach, describe, expect, it, vi } from "vitest";

// The service takes its client as `tx`, so the module-level `prisma` import is
// never used here — but importing it would construct a real client. Stubbing it
// is what keeps this a pure test (`npm run test:pure`, no database).
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { RoomCapacityService } from "@/lib/services/room-capacity-service";

type Holder = { tenant_id: string };

const room = {
  id: "room-1",
  capacity: 4,
  is_active: true,
  hostels: { owner_id: "owner-1", status: "ACTIVE" },
};

/**
 * A room holding three allocated tenants, plus whichever tenants are named as
 * holding a reservation and/or an invitation on it.
 */
function createDb(options: { reservations?: string[]; invitations?: string[]; allocated?: string[] } = {}) {
  const allocated = options.allocated ?? ["tenant-1", "tenant-2", "tenant-3"];
  const reservations: Holder[] = (options.reservations ?? []).map((tenant_id) => ({ tenant_id }));
  const invitations: Holder[] = (options.invitations ?? []).map((tenant_id) => ({ tenant_id }));
  return {
    rooms: {
      findUnique: vi.fn(async () => room),
      findMany: vi.fn(async () => [
        { ...room, tenant_invitation_reservations: reservations, tenant_invitations: invitations,
          _count: { tenant_invitation_reservations: reservations.length, tenant_invitations: invitations.length } },
      ]),
    },
    roomAllocation: {
      findMany: vi.fn(async () => allocated.map((tenant_id) => ({ tenant_id, room_id: "room-1" }))),
    },
    tenant_invitation_reservations: {
      findMany: vi.fn(async () => reservations),
      count: vi.fn(async () => reservations.length),
    },
    tenant_invitations: {
      findMany: vi.fn(async () => invitations),
      count: vi.fn(async () => invitations.length),
    },
  };
}

// `count`/`_count` are deliberately still offered above even though the service
// no longer calls them: counting rows rather than tenancies is the defect these
// tests exist for, so the mock lets that implementation run and be caught by an
// assertion rather than by a missing method.

/** The same invitee holding both a reservation and its invitation — the ordinary pre-activation state. */
function invitedBy(...tenantIds: string[]) {
  return { reservations: tenantIds, invitations: tenantIds };
}

describe("RoomCapacityService", () => {
  let service: RoomCapacityService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RoomCapacityService();
  });

  it("counts active invitation reservations as capacity holds", async () => {
    const snapshot = await service.getRoomCapacitySnapshot("room-1", { tx: createDb(invitedBy("invitee-1")) as any });

    expect(snapshot.occupied).toBe(3);
    expect(snapshot.reserved).toBe(1);
    expect(snapshot.used).toBe(4);
    expect(snapshot.available).toBe(0);
    expect(snapshot.state).toBe("full");
  });

  it("frees capacity after invitation reservation cancellation", async () => {
    const snapshot = await service.getRoomCapacitySnapshot("room-1", { tx: createDb() as any });

    expect(snapshot.occupied).toBe(3);
    expect(snapshot.reserved).toBe(0);
    expect(snapshot.used).toBe(3);
    expect(snapshot.available).toBe(1);
    expect(snapshot.state).toBe("partial");
  });

  it("still holds a bed for an invitation whose reservation row is gone", async () => {
    // The reservation is the bed-level record, but an invitation that outlived
    // it — because the release failed, or was never written — is still somebody
    // on their way in. Losing the row must not quietly hand their bed away.
    const snapshot = await service.getRoomCapacitySnapshot("room-1", {
      tx: createDb({ invitations: ["invitee-1"] }) as any,
    });

    expect(snapshot.reserved).toBe(1);
    expect(snapshot.available).toBe(0);
  });

  it("counts a joined tenant who has paid nothing as occupying their bed", async () => {
    // The occupancy count used to consult each tenant's deposit and skip anyone
    // still `PAYMENT_PENDING`, so an unpaid tenant who had already moved in left
    // their bed looking vacant — and invitable to somebody else. The db mock here
    // supplies no ledger, payment or obligation data at all: if occupancy still
    // depended on money, this call could not produce 3.
    const db = createDb();
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

  describe("a tenancy that is live but not yet accepted (ADR-165)", () => {
    // `createInvitation` stands the tenancy up immediately — ACTIVE tenant, real
    // allocation, bed occupied — and *deliberately* leaves the invitation
    // `PENDING`/`OPENED` until the tenant personally accepts. Counting rows, the
    // same person then appeared twice: once occupied, once reserved. A 4-bed room
    // with two owner-added tenants read 4/4 full and the owner could not put
    // anybody in the two beds that were really empty.

    it("counts one bed, not two, for a tenant who occupies the bed their invitation names", async () => {
      const snapshot = await service.getRoomCapacitySnapshot("room-1", {
        tx: createDb({ allocated: ["tenant-1", "tenant-2"], invitations: ["tenant-1", "tenant-2"] }) as any,
      });

      expect(snapshot.occupied).toBe(2);
      expect(snapshot.reserved).toBe(0);
      expect(snapshot.used).toBe(2);
      expect(snapshot.available).toBe(2);
      expect(snapshot.state).toBe("partial");
    });

    it("keeps holding beds for invitees who have not moved in, alongside them", async () => {
      const snapshot = await service.getRoomCapacitySnapshot("room-1", {
        tx: createDb({ allocated: ["tenant-1"], invitations: ["tenant-1"], reservations: ["invitee-2"] }) as any,
      });

      expect(snapshot.occupied).toBe(1);
      expect(snapshot.reserved).toBe(1);
      expect(snapshot.available).toBe(2);
    });

    it("does the same for the whole-hostel map the Rooms tab reads", async () => {
      const map = await service.getHostelCapacityMap("hostel-1", {
        tx: createDb({ allocated: ["tenant-1", "tenant-2"], invitations: ["tenant-1", "tenant-2"] }) as any,
      });

      expect(map.get("room-1")).toMatchObject({ occupied: 2, reserved: 0, used: 2, available: 2 });
    });
  });

  it("counts a tenant holding two invitations on one room as one held bed", async () => {
    // Re-inviting writes a new invitation row rather than editing the old one,
    // so the same person can name the same bed twice.
    const snapshot = await service.getRoomCapacitySnapshot("room-1", {
      tx: createDb({ allocated: [], invitations: ["invitee-1", "invitee-1"] }) as any,
    });

    expect(snapshot.reserved).toBe(1);
  });
});
