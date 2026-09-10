import { describe, expect, it } from "vitest";
import { buildRoomPlan, type ExistingRoom } from "@/lib/services/bulk-import/room-plan";
import type { RoomImportRow } from "@/lib/services/bulk-import/rooms-sheet";

function existing(over: Partial<ExistingRoom> = {}): ExistingRoom {
  return {
    id: "r-101",
    room_no: "101",
    capacity: 3,
    base_rent: 8500,
    is_active: true,
    occupied_count: 0,
    reserved_count: 0,
    floor: 1,
    ...over,
  };
}

function sheet(over: Partial<RoomImportRow> = {}): RoomImportRow {
  return { room_no: "101", capacity: 3, base_rent: 8500, floor: 1, ...over };
}

describe("buildRoomPlan", () => {
  it("creates a room the hostel does not have", () => {
    const plan = buildRoomPlan([sheet({ room_no: "205", capacity: 2, base_rent: 7000, floor: 2 })], []);
    expect(plan.create.map((r) => r.room_no)).toEqual(["205"]);
    expect(plan.update).toEqual([]);
    expect(plan.issues).toEqual([]);
  });

  it("leaves an unchanged room alone", () => {
    const plan = buildRoomPlan([sheet()], [existing()]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.unchanged).toEqual(["101"]);
  });

  it("updates a room whose rent the owner edited", () => {
    const plan = buildRoomPlan([sheet({ base_rent: 9000 })], [existing()]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]).toMatchObject({ id: "r-101", room_no: "101", to: { base_rent: 9000 } });
    expect(plan.update[0].from).toMatchObject({ base_rent: 8500 });
  });

  it("matches an existing room case- and space-insensitively", () => {
    const plan = buildRoomPlan([sheet({ room_no: " 101 " })], [existing()]);
    expect(plan.create).toEqual([]);
    expect(plan.unchanged).toEqual(["101"]);
  });

  it("blocks a room listed twice, naming the other row", () => {
    const plan = buildRoomPlan([sheet(), sheet()], []);
    const issue = plan.issues.find((i) => i.code === "ROOM_SHEET_DUPLICATE");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("BLOCKER");
    expect(issue!.detail).toContain("row 2");
    expect(plan.create).toHaveLength(1);
  });

  it("blocks shrinking a room below the people already in it", () => {
    const plan = buildRoomPlan(
      [sheet({ capacity: 1 })],
      [existing({ occupied_count: 2, reserved_count: 1 })]
    );
    const issue = plan.issues.find((i) => i.code === "ROOM_CAPACITY_BELOW_OCCUPANCY")!;
    expect(issue.detail).toContain("3");
    expect(plan.update).toEqual([]);
  });

  it("allows shrinking to exactly the number of people already there", () => {
    const plan = buildRoomPlan([sheet({ capacity: 2 })], [existing({ occupied_count: 2 })]);
    expect(plan.issues).toEqual([]);
    expect(plan.update[0].to).toMatchObject({ capacity: 2 });
  });

  it("blocks an unreadable capacity, quoting what the owner typed", () => {
    const plan = buildRoomPlan([{ room_no: "301", capacity: NaN, raw_values: { capacity: "two" } }], []);
    const issue = plan.issues.find((i) => i.code === "ROOM_SHEET_NUMBER_INVALID")!;
    expect(issue.title).toContain('"two"');
    expect(issue.title).not.toContain("NaN");
    expect(plan.create).toEqual([]);
  });

  it("requires a bed count for a room it has to create", () => {
    const plan = buildRoomPlan([{ room_no: "301" }], []);
    expect(plan.create).toEqual([]);
    expect(plan.issues.some((i) => i.severity === "BLOCKER")).toBe(true);
  });

  it("does not require a bed count for a room that already exists", () => {
    const plan = buildRoomPlan([{ room_no: "101" }], [existing()]);
    expect(plan.issues).toEqual([]);
    expect(plan.unchanged).toEqual(["101"]);
  });

  it("rejects a bed count outside what a room can hold", () => {
    expect(buildRoomPlan([sheet({ room_no: "401", capacity: 0 })], []).issues).toHaveLength(1);
    expect(buildRoomPlan([sheet({ room_no: "402", capacity: 99 })], []).issues).toHaveLength(1);
    expect(buildRoomPlan([sheet({ room_no: "403", capacity: 2.5 })], []).issues).toHaveLength(1);
  });

  it("reports every problem in the sheet, not just the first", () => {
    const plan = buildRoomPlan(
      [
        { room_no: "301", capacity: NaN, raw_values: { capacity: "two" } },
        { room_no: "302" },
        sheet({ room_no: "303", capacity: 0 }),
      ],
      []
    );
    expect(plan.issues).toHaveLength(3);
    expect(plan.create).toEqual([]);
  });
});
