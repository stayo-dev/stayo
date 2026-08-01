import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Atomic hostel provisioning (audit Task 1).
 *
 * The onboarding wizard used to publish a hostel with 1 + F + (F×R) sequential
 * HTTP calls and no transaction: a failure at floor 3 of 5 left a partially
 * built hostel in the database, and pressing Publish again hit the
 * owner-scoped duplicate-name guard and returned 400 forever. These tests pin
 * the replacement: one call, one transaction, all-or-nothing.
 */

const { mockPrisma, mockTx, triggerEvent, markHostelCreated } = vi.hoisted(() => {
  const mockTx = {
    hostels: { create: vi.fn() },
    floors: { create: vi.fn() },
    rooms: { createMany: vi.fn() },
  };
  return {
    mockTx,
    triggerEvent: vi.fn().mockResolvedValue(undefined),
    markHostelCreated: vi.fn().mockResolvedValue(undefined),
    mockPrisma: {
      hostels: { findFirst: vi.fn(), create: vi.fn() },
      floors: { create: vi.fn() },
      rooms: { createMany: vi.fn(), create: vi.fn() },
      $transaction: vi.fn(),
    },
  };
});

vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/services/event-log-service", () => ({
  eventLog: { log: vi.fn().mockResolvedValue({}) },
}));
vi.mock("../lib/services/event-log-service", () => ({
  eventLog: { log: vi.fn().mockResolvedValue({}) },
}));

vi.mock("@/lib/events", () => ({ eventSystem: { trigger: triggerEvent } }));
vi.mock("../lib/events", () => ({ eventSystem: { trigger: triggerEvent } }));

vi.mock("@/src/services/platform-leads/lead-invitation-service", () => ({
  leadInvitationService: { markHostelCreated },
}));
vi.mock("../src/services/platform-leads/lead-invitation-service", () => ({
  leadInvitationService: { markHostelCreated },
}));

import { hostelProvisioningService } from "../lib/services/hostel-provisioning-service";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const HOSTEL_ID = "22222222-2222-4222-8222-222222222222";

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Sunrise Residency",
    type: "CO_LIVING" as const,
    address: "12 MG Road, Indiranagar",
    city: "Bengaluru",
    food_included: true,
    security_deposit: 10000,
    floors: 2,
    rooms_per_floor: 3,
    beds_per_room: 4,
    base_rent: 6500,
    publish: "now" as const,
    ...overrides,
  };
}

/** Runs the interactive-transaction callback against `mockTx`, like Prisma does. */
function runTransaction() {
  mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));
}

/** Every room row passed to every `createMany` call, flattened. */
function createdRooms() {
  return mockTx.rooms.createMany.mock.calls.flatMap((call: any[]) => call[0].data);
}

describe("hostelProvisioningService.provision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.hostels.findFirst.mockResolvedValue(null);
    mockTx.hostels.create.mockImplementation(async ({ data }: any) => ({ id: HOSTEL_ID, ...data }));
    mockTx.floors.create.mockImplementation(async ({ data }: any) => ({
      id: `floor-${data.sort_order}`,
      ...data,
    }));
    mockTx.rooms.createMany.mockResolvedValue({ count: 0 });
    runTransaction();
  });

  describe("atomicity", () => {
    it("does all of its writing inside exactly one transaction", async () => {
      await hostelProvisioningService.provision(OWNER_ID, validInput());

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      // Nothing may be written through the non-transactional client.
      expect(mockPrisma.hostels.create).not.toHaveBeenCalled();
      expect(mockPrisma.floors.create).not.toHaveBeenCalled();
      expect(mockPrisma.rooms.createMany).not.toHaveBeenCalled();
      expect(mockPrisma.rooms.create).not.toHaveBeenCalled();
    });

    it("propagates a mid-flight failure so the transaction rolls back", async () => {
      mockTx.rooms.createMany
        .mockResolvedValueOnce({ count: 3 })
        .mockRejectedValueOnce(new Error("connection lost"));

      await expect(hostelProvisioningService.provision(OWNER_ID, validInput())).rejects.toThrow(
        /connection lost/,
      );

      // The hostel row was only ever created on the transaction client, so the
      // rollback takes it with it — there is no committed partial hostel.
      expect(mockPrisma.hostels.create).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("gives the transaction a timeout large enough for a big property", async () => {
      await hostelProvisioningService.provision(
        OWNER_ID,
        validInput({ floors: 8, rooms_per_floor: 20 }),
      );

      const options = mockPrisma.$transaction.mock.calls[0][1];
      expect(options?.timeout).toBeGreaterThanOrEqual(15000);
    });
  });

  describe("structure", () => {
    it("creates one floor per requested floor, in order", async () => {
      await hostelProvisioningService.provision(OWNER_ID, validInput({ floors: 3 }));

      expect(mockTx.floors.create).toHaveBeenCalledTimes(3);
      const names = mockTx.floors.create.mock.calls.map((c: any[]) => c[0].data.name);
      expect(names).toEqual(["Floor 1", "Floor 2", "Floor 3"]);
      const orders = mockTx.floors.create.mock.calls.map((c: any[]) => c[0].data.sort_order);
      expect(orders).toEqual([1, 2, 3]);
    });

    it("creates floors × rooms_per_floor rooms with the requested bed capacity", async () => {
      await hostelProvisioningService.provision(
        OWNER_ID,
        validInput({ floors: 2, rooms_per_floor: 3, beds_per_room: 4 }),
      );

      const rooms = createdRooms();
      expect(rooms).toHaveLength(6);
      expect(rooms.every((r: any) => r.capacity === 4)).toBe(true);
    });

    it("keeps the room numbering the old publish loop produced", async () => {
      await hostelProvisioningService.provision(
        OWNER_ID,
        validInput({ floors: 2, rooms_per_floor: 3 }),
      );

      expect(createdRooms().map((r: any) => r.room_no)).toEqual([
        "101",
        "102",
        "103",
        "201",
        "202",
        "203",
      ]);
    });

    it("attaches every room to its own floor", async () => {
      await hostelProvisioningService.provision(
        OWNER_ID,
        validInput({ floors: 2, rooms_per_floor: 2 }),
      );

      const rooms = createdRooms();
      expect(rooms.filter((r: any) => r.floor_id === "floor-1")).toHaveLength(2);
      expect(rooms.filter((r: any) => r.floor_id === "floor-2")).toHaveLength(2);
    });

    it("scopes every row to the hostel it just created", async () => {
      await hostelProvisioningService.provision(OWNER_ID, validInput());

      expect(
        mockTx.floors.create.mock.calls.every((c: any[]) => c[0].data.hostel_id === HOSTEL_ID),
      ).toBe(true);
      expect(createdRooms().every((r: any) => r.hostel_id === HOSTEL_ID)).toBe(true);
    });
  });

  describe("field persistence", () => {
    it("persists the base rent the owner entered on every room", async () => {
      await hostelProvisioningService.provision(OWNER_ID, validInput({ base_rent: 6500 }));

      const rooms = createdRooms();
      expect(rooms).not.toHaveLength(0);
      expect(rooms.every((r: any) => r.base_rent === 6500)).toBe(true);
    });

    it("persists the hostel type", async () => {
      await hostelProvisioningService.provision(OWNER_ID, validInput({ type: "GIRLS" }));

      expect(mockTx.hostels.create.mock.calls[0][0].data.hostel_type).toBe("GIRLS");
    });

    it("persists whether food is included", async () => {
      await hostelProvisioningService.provision(OWNER_ID, validInput({ food_included: false }));

      expect(mockTx.hostels.create.mock.calls[0][0].data.food_included).toBe(false);
    });

    it("persists the security deposit into the hostel's billing defaults", async () => {
      await hostelProvisioningService.provision(OWNER_ID, validInput({ security_deposit: 10000 }));

      const config = mockTx.hostels.create.mock.calls[0][0].data.preferences_config;
      expect(config.billing_defaults.security_deposit).toBe(10000);
      // The billing service treats advance_deposit as the same figure — keep
      // both in step so tenant invites resolve the deposit the owner entered.
      expect(config.billing_defaults.advance_deposit).toBe(10000);
    });

    it("records a publish-now choice as a publish request", async () => {
      await hostelProvisioningService.provision(OWNER_ID, validInput({ publish: "now" }));

      expect(mockTx.hostels.create.mock.calls[0][0].data.publish_requested).toBe(true);
    });

    it("records a keep-as-draft choice as no publish request", async () => {
      await hostelProvisioningService.provision(OWNER_ID, validInput({ publish: "draft" }));

      expect(mockTx.hostels.create.mock.calls[0][0].data.publish_requested).toBe(false);
    });

    it("never lets an owner publish themselves LIVE past admin verification", async () => {
      await hostelProvisioningService.provision(OWNER_ID, validInput({ publish: "now" }));

      const data = mockTx.hostels.create.mock.calls[0][0].data;
      expect(data.listing_status).not.toBe("LIVE");
      expect(data.verification_status).not.toBe("VERIFIED");
    });
  });

  describe("owner isolation", () => {
    it("creates the hostel under the calling owner", async () => {
      await hostelProvisioningService.provision(OWNER_ID, validInput());

      expect(mockTx.hostels.create.mock.calls[0][0].data.owner_id).toBe(OWNER_ID);
      expect(
        mockTx.floors.create.mock.calls.every((c: any[]) => c[0].data.owner_id === OWNER_ID),
      ).toBe(true);
    });

    it("scopes the duplicate-name check to the calling owner", async () => {
      await hostelProvisioningService.provision(OWNER_ID, validInput());

      expect(mockPrisma.hostels.findFirst.mock.calls[0][0].where.owner_id).toBe(OWNER_ID);
    });
  });

  describe("retry safety", () => {
    it("opens no transaction when the owner already has that hostel", async () => {
      mockPrisma.hostels.findFirst.mockResolvedValue({ id: HOSTEL_ID, name: "Sunrise Residency" });

      await expect(hostelProvisioningService.provision(OWNER_ID, validInput())).rejects.toThrow(
        /ALREADY_EXISTS/,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("names the existing hostel so a stuck owner can be sent to it instead of dead-ending", async () => {
      mockPrisma.hostels.findFirst.mockResolvedValue({ id: HOSTEL_ID, name: "Sunrise Residency" });

      const error = await hostelProvisioningService
        .provision(OWNER_ID, validInput())
        .catch((e: any) => e);

      expect(error.hostelId).toBe(HOSTEL_ID);
    });

    it("lets a retry through once the failed attempt left nothing behind", async () => {
      mockTx.rooms.createMany.mockRejectedValueOnce(new Error("connection lost"));
      await expect(hostelProvisioningService.provision(OWNER_ID, validInput())).rejects.toThrow();

      // Rollback means the duplicate-name lookup still finds nothing.
      mockTx.rooms.createMany.mockResolvedValue({ count: 3 });
      await expect(
        hostelProvisioningService.provision(OWNER_ID, validInput()),
      ).resolves.toMatchObject({ hostel: { id: HOSTEL_ID } });
    });
  });

  describe("validation", () => {
    it("rejects a missing base rent — a provisioned room must have a real rent", async () => {
      await expect(
        hostelProvisioningService.provision(OWNER_ID, validInput({ base_rent: null })),
      ).rejects.toThrow(/VALIDATION/);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("rejects a negative base rent", async () => {
      await expect(
        hostelProvisioningService.provision(OWNER_ID, validInput({ base_rent: -1 })),
      ).rejects.toThrow(/VALIDATION/);
    });

    it("rejects a negative security deposit", async () => {
      await expect(
        hostelProvisioningService.provision(OWNER_ID, validInput({ security_deposit: -5 })),
      ).rejects.toThrow(/VALIDATION/);
    });

    it("rejects a structure with no floors, rooms or beds", async () => {
      await expect(
        hostelProvisioningService.provision(OWNER_ID, validInput({ floors: 0 })),
      ).rejects.toThrow(/VALIDATION/);
      await expect(
        hostelProvisioningService.provision(OWNER_ID, validInput({ rooms_per_floor: 0 })),
      ).rejects.toThrow(/VALIDATION/);
      await expect(
        hostelProvisioningService.provision(OWNER_ID, validInput({ beds_per_room: 0 })),
      ).rejects.toThrow(/VALIDATION/);
    });

    it("rejects an unknown hostel type", async () => {
      await expect(
        hostelProvisioningService.provision(OWNER_ID, validInput({ type: "PENTHOUSE" })),
      ).rejects.toThrow(/VALIDATION/);
    });

    it("requires a hostel name", async () => {
      await expect(
        hostelProvisioningService.provision(OWNER_ID, validInput({ name: " " })),
      ).rejects.toThrow(/VALIDATION/);
    });
  });

  describe("lead lifecycle", () => {
    // POST /api/owner/hostels advanced an OWNER_ACTIVATED lead to
    // HOSTEL_CREATED. `markLive` (called by the wizard's trailing
    // /leads/invitation/:token/complete) only promotes a lead that is already
    // at HOSTEL_CREATED — so if provisioning skips this, a lead-originated
    // owner silently never reaches LIVE.
    it("advances the owner's lead once the hostel really exists", async () => {
      await hostelProvisioningService.provision(OWNER_ID, validInput());

      expect(markHostelCreated).toHaveBeenCalledWith(OWNER_ID);
    });

    it("does not advance the lead when provisioning rolled back", async () => {
      mockTx.rooms.createMany.mockRejectedValueOnce(new Error("connection lost"));

      await expect(hostelProvisioningService.provision(OWNER_ID, validInput())).rejects.toThrow();
      expect(markHostelCreated).not.toHaveBeenCalled();
    });

    it("still returns the hostel when the lead update fails", async () => {
      markHostelCreated.mockRejectedValueOnce(new Error("leads table unavailable"));

      await expect(
        hostelProvisioningService.provision(OWNER_ID, validInput()),
      ).resolves.toMatchObject({ hostel: { id: HOSTEL_ID } });
    });
  });

  describe("result", () => {
    it("returns the hostel and what it built", async () => {
      const result = await hostelProvisioningService.provision(
        OWNER_ID,
        validInput({ floors: 2, rooms_per_floor: 3 }),
      );

      expect(result.hostel.id).toBe(HOSTEL_ID);
      expect(result.floors_created).toBe(2);
      expect(result.rooms_created).toBe(6);
    });
  });
});
