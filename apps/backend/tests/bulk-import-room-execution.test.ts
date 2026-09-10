import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Applying a Rooms-sheet plan.
 *
 * The hazard this file exists for: `saveRoomsForFloor` takes the floor as it
 * *should be*, and retires any room on that floor missing from the list. So
 * submitting only the new rooms would switch off every room already there.
 */

const { mockPrisma, mockProperty } = vi.hoisted(() => ({
  mockPrisma: {
    floors: { findMany: vi.fn() },
    rooms: { findMany: vi.fn(), update: vi.fn() },
  } as any,
  mockProperty: { createFloor: vi.fn(), saveRoomsForFloor: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/services/property-service", () => ({ propertyService: mockProperty }));

import { applyRoomPlan } from "@/src/services/bulk-import/room-import-service";
import type { RoomPlan } from "@/lib/services/bulk-import/room-plan";

const OWNER = "owner-1";
const HOSTEL = "hostel-1";

function plan(over: Partial<RoomPlan> = {}): RoomPlan {
  return { create: [], update: [], unchanged: [], issues: [], ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.floors.findMany.mockResolvedValue([{ id: "floor-1", name: "Floor 1", sort_order: 1 }]);
  mockPrisma.rooms.findMany.mockResolvedValue([
    { id: "r-101", room_no: "101", floor_id: "floor-1", capacity: 3, base_rent: 8500, room_type: "Triple" },
    { id: "r-102", room_no: "102", floor_id: "floor-1", capacity: 2, base_rent: 7000, room_type: "Double" },
  ]);
  mockPrisma.rooms.update.mockResolvedValue({});
  mockProperty.saveRoomsForFloor.mockResolvedValue([]);
  mockProperty.createFloor.mockImplementation(async (_o: string, _h: string, d: any) => ({
    id: `floor-new-${d.sort_order}`,
    name: d.name,
  }));
});

describe("applyRoomPlan", () => {
  it("does nothing at all when there is nothing to create or update", async () => {
    const result = await applyRoomPlan(plan({ unchanged: ["101"] }), OWNER, HOSTEL);
    expect(result).toEqual({ created: 0, updated: 0, errors: [] });
    expect(mockProperty.saveRoomsForFloor).not.toHaveBeenCalled();
    expect(mockProperty.createFloor).not.toHaveBeenCalled();
  });

  it("submits the rooms already on the floor alongside the new one", async () => {
    await applyRoomPlan(
      plan({ create: [{ room_no: "103", floor: 1, capacity: 4, base_rent: 6000, sharing_type: "Four sharing" }] }),
      OWNER,
      HOSTEL
    );

    expect(mockProperty.saveRoomsForFloor).toHaveBeenCalledTimes(1);
    const [floorId, ownerId, submitted] = mockProperty.saveRoomsForFloor.mock.calls[0];
    expect(floorId).toBe("floor-1");
    expect(ownerId).toBe(OWNER);
    // 101 and 102 must be in the list or they would be retired.
    expect(submitted.map((r: any) => r.room_no).sort()).toEqual(["101", "102", "103"]);
  });

  it("keeps each existing room's current values when it submits them", async () => {
    await applyRoomPlan(plan({ create: [{ room_no: "103", floor: 1, capacity: 4 }] }), OWNER, HOSTEL);

    const [, , submitted] = mockProperty.saveRoomsForFloor.mock.calls[0];
    expect(submitted.find((r: any) => r.room_no === "101")).toMatchObject({
      capacity: 3,
      base_rent: 8500,
      room_type: "Triple",
    });
  });

  it("applies an edit to an existing room, leaving its neighbours untouched", async () => {
    const result = await applyRoomPlan(
      plan({
        update: [{ id: "r-101", room_no: "101", from: { capacity: 3, base_rent: 8500 }, to: { base_rent: 9000 } }],
      }),
      OWNER,
      HOSTEL
    );

    const [, , submitted] = mockProperty.saveRoomsForFloor.mock.calls[0];
    expect(submitted.find((r: any) => r.room_no === "101")).toMatchObject({ base_rent: 9000, capacity: 3 });
    expect(submitted.find((r: any) => r.room_no === "102")).toMatchObject({ base_rent: 7000 });
    expect(result.updated).toBe(1);
  });

  it("saves one call per floor, not one per room", async () => {
    await applyRoomPlan(
      plan({
        create: [
          { room_no: "103", floor: 1, capacity: 2 },
          { room_no: "104", floor: 1, capacity: 2 },
        ],
      }),
      OWNER,
      HOSTEL
    );
    expect(mockProperty.saveRoomsForFloor).toHaveBeenCalledTimes(1);
  });

  it("creates a floor the hostel does not have yet, named for the owner", async () => {
    await applyRoomPlan(plan({ create: [{ room_no: "201", floor: 2, capacity: 3 }] }), OWNER, HOSTEL);

    expect(mockProperty.createFloor).toHaveBeenCalledWith(OWNER, HOSTEL, { name: "Floor 2", sort_order: 2 });
    const call = mockProperty.saveRoomsForFloor.mock.calls.find((c: any[]) => c[0] === "floor-new-2");
    expect(call).toBeDefined();
    // A brand-new floor has no existing rooms, so only the new one is sent.
    expect(call![2].map((r: any) => r.room_no)).toEqual(["201"]);
  });

  it("calls the ground floor by its name", async () => {
    await applyRoomPlan(plan({ create: [{ room_no: "G1", floor: 0, capacity: 2 }] }), OWNER, HOSTEL);
    expect(mockProperty.createFloor).toHaveBeenCalledWith(OWNER, HOSTEL, { name: "Ground floor", sort_order: 0 });
  });

  it("reuses a floor it just created for a second room on the same floor", async () => {
    await applyRoomPlan(
      plan({ create: [
        { room_no: "201", floor: 2, capacity: 3 },
        { room_no: "202", floor: 2, capacity: 3 },
      ] }),
      OWNER,
      HOSTEL
    );
    expect(mockProperty.createFloor).toHaveBeenCalledTimes(1);
    expect(mockProperty.saveRoomsForFloor).toHaveBeenCalledTimes(1);
  });

  it("records a floor's failure without stopping the others", async () => {
    mockProperty.saveRoomsForFloor.mockImplementation(async (floorId: string) => {
      if (floorId === "floor-1") throw new Error("CONFLICT: Room 101 already exists in this hostel");
      return [];
    });

    const result = await applyRoomPlan(
      plan({ create: [
        { room_no: "103", floor: 1, capacity: 2 },
        { room_no: "201", floor: 2, capacity: 3 },
      ] }),
      OWNER,
      HOSTEL
    );

    expect(result.errors.map((e) => e.room_no)).toContain("103");
    expect(result.created).toBe(1); // the floor-2 room still landed
  });

  it("edits a room that belongs to no floor directly", async () => {
    mockPrisma.rooms.findMany.mockResolvedValue([
      { id: "r-x", room_no: "X1", floor_id: null, capacity: 2, base_rent: 5000, room_type: null },
    ]);

    const result = await applyRoomPlan(
      plan({ update: [{ id: "r-x", room_no: "X1", from: { capacity: 2, base_rent: 5000 }, to: { capacity: 3 } }] }),
      OWNER,
      HOSTEL
    );

    expect(mockProperty.saveRoomsForFloor).not.toHaveBeenCalled();
    expect(mockPrisma.rooms.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r-x" }, data: expect.objectContaining({ capacity: 3 }) })
    );
    expect(result.updated).toBe(1);
  });
});
