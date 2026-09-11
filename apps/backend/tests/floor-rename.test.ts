import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owners can now rename a floor from the Rooms tab. The API already accepted a
 * name, but took a blank one, took a duplicate, and answered every mistake
 * with a 500 "Failed to update floor" — which reads as the app breaking.
 */

const mocks = vi.hoisted(() => ({
  floorsFindUnique: vi.fn(),
  floorsFindFirst: vi.fn(),
  floorsUpdate: vi.fn(),
  floorsCreate: vi.fn(),
  hostelsFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    floors: {
      findUnique: mocks.floorsFindUnique,
      findFirst: mocks.floorsFindFirst,
      update: mocks.floorsUpdate,
      create: mocks.floorsCreate,
    },
    hostels: { findUnique: mocks.hostelsFindUnique },
  },
}));

import { FLOOR_NAME_MAX, propertyService } from "@/lib/services/property-service";

const HOSTEL = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.floorsFindUnique.mockResolvedValue({
    id: "f1",
    hostel_id: HOSTEL,
    name: "Floor 1",
    hostel: { owner_id: "owner-1", status: "ACTIVE" },
  });
  mocks.floorsFindFirst.mockResolvedValue(null);
  mocks.floorsUpdate.mockImplementation(async ({ data }: any) => ({ id: "f1", ...data }));
  mocks.hostelsFindUnique.mockResolvedValue({ id: HOSTEL, owner_id: "owner-1", status: "ACTIVE" });
  mocks.floorsCreate.mockImplementation(async ({ data }: any) => ({ id: "new", ...data }));
});

describe("renaming a floor", () => {
  it("saves the new name, tidied", async () => {
    await propertyService.updateFloor("f1", "owner-1", { name: "  Ground   floor " });

    expect(mocks.floorsUpdate).toHaveBeenCalledWith({ where: { id: "f1" }, data: { name: "Ground floor" } });
  });

  it("refuses a blank name, in the owner's words", async () => {
    await expect(propertyService.updateFloor("f1", "owner-1", { name: "   " })).rejects.toThrow(
      "VALIDATION: Give the floor a name"
    );
    expect(mocks.floorsUpdate).not.toHaveBeenCalled();
  });

  it("refuses a name another floor in this hostel already has", async () => {
    mocks.floorsFindFirst.mockResolvedValue({ id: "f2" });

    await expect(propertyService.updateFloor("f1", "owner-1", { name: "ground" })).rejects.toThrow(
      /already has a floor called "ground"/
    );
  });

  it("compares names within this hostel, ignoring case, and never against itself", async () => {
    await propertyService.updateFloor("f1", "owner-1", { name: "Ground" });

    expect(mocks.floorsFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          hostel_id: HOSTEL,
          id: { not: "f1" },
          name: { equals: "Ground", mode: "insensitive" },
        }),
      })
    );
  });

  it("refuses a name too long for a phone header", async () => {
    await expect(
      propertyService.updateFloor("f1", "owner-1", { name: "x".repeat(FLOOR_NAME_MAX + 1) })
    ).rejects.toThrow(/under 40 characters/);
  });

  it("still reorders without a name", async () => {
    await propertyService.updateFloor("f1", "owner-1", { sort_order: 3 });

    expect(mocks.floorsFindFirst).not.toHaveBeenCalled();
    expect(mocks.floorsUpdate).toHaveBeenCalledWith({ where: { id: "f1" }, data: { sort_order: 3 } });
  });

  it("will not touch another owner's floor", async () => {
    await expect(propertyService.updateFloor("f1", "owner-2", { name: "Mine now" })).rejects.toThrow("NOT_FOUND");
  });
});

describe("adding a floor", () => {
  /** Create and rename share one rule, so they cannot disagree about a valid name. */
  it("obeys the same rule as renaming", async () => {
    mocks.floorsFindFirst.mockResolvedValue({ id: "f2" });

    await expect(propertyService.createFloor("owner-1", HOSTEL, { name: "Floor 1" })).rejects.toThrow(
      /already has a floor/
    );
    expect(mocks.floorsCreate).not.toHaveBeenCalled();
  });
});
