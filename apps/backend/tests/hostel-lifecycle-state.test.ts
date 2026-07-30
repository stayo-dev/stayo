import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => {
  return {
    mockPrisma: {
      profile: {
        findUnique: vi.fn(),
      },
      hostels: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      roomAllocation: {
        count: vi.fn(),
      },
      floors: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      rooms: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

// Mock the database client
vi.mock("../lib/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

// Mock operational event logger
vi.mock("@/lib/services/event-log-service", () => ({
  eventLog: {
    log: vi.fn().mockResolvedValue({}),
  },
}));

import { PropertyService } from "../lib/services/property-service";
import { assertHostelBelongsToOwner, resolveHostelContext } from "../lib/security/scoped-query";

describe("Hostel Lifecycle State Machine", () => {
  const propertyService = new PropertyService();
  const ownerId = "owner-123";
  const hostelId = "4b2e66ef-c782-4217-bfd3-2fb53bf7be7a";

  beforeEach(() => {
    mockPrisma.hostels.findFirst.mockReset();
    mockPrisma.hostels.findMany.mockReset();
    mockPrisma.hostels.findUnique.mockReset();
    mockPrisma.hostels.create.mockReset();
    mockPrisma.hostels.update.mockReset();
    mockPrisma.hostels.updateMany.mockReset();
    mockPrisma.profile.findUnique.mockReset();
    mockPrisma.roomAllocation.count.mockReset();
    mockPrisma.floors.findUnique.mockReset();
    mockPrisma.floors.create.mockReset();
    mockPrisma.floors.update.mockReset();
    mockPrisma.floors.delete.mockReset();
    mockPrisma.rooms.findUnique.mockReset();
    mockPrisma.rooms.findFirst.mockReset();
    mockPrisma.rooms.update.mockReset();
  });

  describe("updateHostel status validations & transitions", () => {
    it("should reject invalid statuses", async () => {
      mockPrisma.profile.findUnique.mockResolvedValue({ id: ownerId });

      await expect(
        propertyService.updateHostel(ownerId, {
          hostel_id: hostelId,
          status: "INVALID_STATUS",
        })
      ).rejects.toThrow("VALIDATION: Invalid hostel status");
    });

    it("should prevent updating fields of an archived hostel", async () => {
      mockPrisma.profile.findUnique.mockResolvedValue({ id: ownerId });
      mockPrisma.hostels.findMany.mockResolvedValue([]);
      mockPrisma.hostels.findUnique.mockResolvedValue({
        id: hostelId,
        owner_id: ownerId,
        status: "ARCHIVED",
        is_active: false,
      });

      // Attempt to rename the archived hostel should be rejected
      await expect(
        propertyService.updateHostel(ownerId, {
          hostel_id: hostelId,
          name: "New Name",
        })
      ).rejects.toThrow("VALIDATION: Cannot modify an archived hostel");
    });

    it("should allow restoring an archived hostel to ACTIVE", async () => {
      mockPrisma.profile.findUnique.mockResolvedValue({ id: ownerId });
      mockPrisma.hostels.findUnique.mockResolvedValue({
        id: hostelId,
        owner_id: ownerId,
        status: "ARCHIVED",
        is_active: false,
      });

      mockPrisma.hostels.update.mockResolvedValue({ id: hostelId });
      mockPrisma.hostels.findMany.mockResolvedValue([]); // for profile lookup mapping
      mockPrisma.profile.findUnique.mockResolvedValue({ id: ownerId, hostels: [] });

      await propertyService.updateHostel(ownerId, {
        hostel_id: hostelId,
        status: "ACTIVE",
      });

      expect(mockPrisma.hostels.update).toHaveBeenCalledWith({
        where: { id: hostelId },
        data: expect.objectContaining({
          status: "ACTIVE",
          is_active: true,
        }),
      });
    });

    it("should block transition to ARCHIVED if there are active allocations", async () => {
      mockPrisma.profile.findUnique.mockResolvedValue({ id: ownerId });
      mockPrisma.hostels.findUnique.mockResolvedValue({
        id: hostelId,
        owner_id: ownerId,
        status: "ACTIVE",
        is_active: true,
      });

      // Mock active allocations found
      mockPrisma.roomAllocation.count.mockResolvedValue(3);

      await expect(
        propertyService.updateHostel(ownerId, {
          hostel_id: hostelId,
          status: "ARCHIVED",
        })
      ).rejects.toThrow("VALIDATION: Cannot archive hostel with active tenant allocations");

      expect(mockPrisma.roomAllocation.count).toHaveBeenCalledWith({
        where: {
          hostel_id: hostelId,
          is_active: true,
        },
      });
    });

    it("should allow transition to ARCHIVED if there are no active allocations", async () => {
      mockPrisma.profile.findUnique.mockResolvedValue({ id: ownerId });
      mockPrisma.hostels.findUnique.mockResolvedValue({
        id: hostelId,
        owner_id: ownerId,
        status: "ACTIVE",
        is_active: true,
      });

      // Mock no active allocations
      mockPrisma.roomAllocation.count.mockResolvedValue(0);
      mockPrisma.hostels.update.mockResolvedValue({ id: hostelId });
      mockPrisma.hostels.findMany.mockResolvedValue([]);
      mockPrisma.profile.findUnique.mockResolvedValue({ id: ownerId, hostels: [] });

      await propertyService.updateHostel(ownerId, {
        hostel_id: hostelId,
        status: "ARCHIVED",
      });

      expect(mockPrisma.hostels.update).toHaveBeenCalledWith({
        where: { id: hostelId },
        data: expect.objectContaining({
          status: "ARCHIVED",
          is_active: false,
        }),
      });
    });

    it("should ignore ARCHIVED hostels in duplicate name checks", async () => {
      mockPrisma.profile.findUnique.mockResolvedValue({ id: ownerId });
      mockPrisma.hostels.findMany.mockResolvedValue([]);
      mockPrisma.hostels.findUnique.mockResolvedValue({
        id: hostelId,
        owner_id: ownerId,
        status: "ACTIVE",
        is_active: true,
      });

      mockPrisma.hostels.update.mockResolvedValue({ id: hostelId });
      mockPrisma.profile.findUnique.mockResolvedValue({ id: ownerId, hostels: [] });

      await propertyService.updateHostel(ownerId, {
        hostel_id: hostelId,
        name: "Unique Hostel Name",
      });

      // Verify the duplicate check excludes ARCHIVED hostels (only checks ACTIVE and INACTIVE)
      expect(mockPrisma.hostels.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          owner_id: ownerId,
          status: { in: ["ACTIVE", "INACTIVE"] },
          name: {
            equals: "Unique Hostel Name",
            mode: "insensitive",
          },
        }),
        take: 1,
      });
    });
  });

  describe("Security scoped query helper validations", () => {
    it("assertHostelBelongsToOwner should allow ACTIVE, INACTIVE, and ARCHIVED hostels", async () => {
      mockPrisma.hostels.findFirst.mockResolvedValue({ id: hostelId, owner_id: ownerId });

      await assertHostelBelongsToOwner(ownerId, hostelId);

      expect(mockPrisma.hostels.findFirst).toHaveBeenCalledWith({
        where: {
          id: hostelId,
          owner_id: ownerId,
          status: { in: ["ACTIVE", "INACTIVE", "ARCHIVED"] },
        },
        select: { id: true, owner_id: true, status: true },
      });
    });

    it("resolveHostelContext should only look up ACTIVE and INACTIVE hostels for fallback context", async () => {
      mockPrisma.hostels.findFirst.mockResolvedValue({ id: hostelId });

      await resolveHostelContext(
        {
          role: "OWNER",
          owner_id: ownerId,
          sub: ownerId,
        } as any,
        null
      );

      expect(mockPrisma.hostels.findFirst).toHaveBeenCalledWith({
        where: {
          owner_id: ownerId,
          status: { in: ["ACTIVE", "INACTIVE"] },
        },
        select: { id: true },
      });
    });
  });

  describe("Floors & Rooms operational hardening for ARCHIVED and INACTIVE hostels", () => {
    it("createFloor should reject if the hostel is ARCHIVED or INACTIVE", async () => {
      // Archived check
      mockPrisma.hostels.findUnique.mockResolvedValueOnce({
        id: hostelId,
        owner_id: ownerId,
        status: "ARCHIVED",
      });

      await expect(
        propertyService.createFloor(ownerId, hostelId, { name: "Floor 1" })
      ).rejects.toThrow("HOSTEL_ARCHIVED: Cannot modify rooms/floors of an archived hostel");

      // Inactive check
      mockPrisma.hostels.findUnique.mockResolvedValueOnce({
        id: hostelId,
        owner_id: ownerId,
        status: "INACTIVE",
      });

      await expect(
        propertyService.createFloor(ownerId, hostelId, { name: "Floor 1" })
      ).rejects.toThrow("VALIDATION: Cannot modify rooms/floors of an inactive hostel");
    });

    it("updateFloor should reject if the hostel is ARCHIVED or INACTIVE", async () => {
      // Archived check
      mockPrisma.floors.findUnique.mockResolvedValueOnce({
        id: "floor-1",
        hostel: { owner_id: ownerId, status: "ARCHIVED" },
      });

      await expect(
        propertyService.updateFloor("floor-1", ownerId, { name: "New Floor Name" })
      ).rejects.toThrow("HOSTEL_ARCHIVED: Cannot modify rooms/floors of an archived hostel");

      // Inactive check
      mockPrisma.floors.findUnique.mockResolvedValueOnce({
        id: "floor-1",
        hostel: { owner_id: ownerId, status: "INACTIVE" },
      });

      await expect(
        propertyService.updateFloor("floor-1", ownerId, { name: "New Floor Name" })
      ).rejects.toThrow("VALIDATION: Cannot modify rooms/floors of an inactive hostel");
    });

    it("deleteFloor should reject if the hostel is ARCHIVED or INACTIVE", async () => {
      // Archived check
      mockPrisma.floors.findUnique.mockResolvedValueOnce({
        id: "floor-1",
        hostel: { owner_id: ownerId, status: "ARCHIVED" },
        rooms: [],
      });

      await expect(
        propertyService.deleteFloor("floor-1", ownerId)
      ).rejects.toThrow("HOSTEL_ARCHIVED: Cannot modify rooms/floors of an archived hostel");

      // Inactive check
      mockPrisma.floors.findUnique.mockResolvedValueOnce({
        id: "floor-1",
        hostel: { owner_id: ownerId, status: "INACTIVE" },
        rooms: [],
      });

      await expect(
        propertyService.deleteFloor("floor-1", ownerId)
      ).rejects.toThrow("VALIDATION: Cannot modify rooms/floors of an inactive hostel");
    });

    it("updateRoom should reject if the hostel is ARCHIVED or INACTIVE", async () => {
      // Archived check
      mockPrisma.rooms.findUnique.mockResolvedValueOnce({
        id: "room-1",
        hostels: { owner_id: ownerId, status: "ARCHIVED" },
      });

      await expect(
        propertyService.updateRoom("room-1", { base_rent: 5000 }, ownerId)
      ).rejects.toThrow("HOSTEL_ARCHIVED: Cannot modify rooms of an archived hostel");

      // Inactive check
      mockPrisma.rooms.findUnique.mockResolvedValueOnce({
        id: "room-1",
        hostels: { owner_id: ownerId, status: "INACTIVE" },
      });

      await expect(
        propertyService.updateRoom("room-1", { base_rent: 5000 }, ownerId)
      ).rejects.toThrow("VALIDATION: Cannot modify rooms of an inactive hostel");
    });
  });
});
