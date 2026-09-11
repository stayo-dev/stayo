import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseRoomsSheet } from "@/lib/services/bulk-import/rooms-sheet";
import { ROOMS_SHEET, TENANTS_SHEET } from "@/lib/services/bulk-import/workbook-parser";

function book(sheets: Array<{ name: string; rows: Record<string, unknown>[] }>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseRoomsSheet", () => {
  it("reads the columns the template writes", () => {
    const buf = book([
      {
        name: ROOMS_SHEET,
        rows: [
          { "Room No": "101", Floor: 1, Capacity: 3, "Sharing Type": "Triple", "Base Rent": "₹8,500" },
          { "Room No": "G1", Floor: 0, Capacity: 2, "Sharing Type": "Double", "Base Rent": 7000 },
        ],
      },
      { name: TENANTS_SHEET, rows: [{ Name: "Ravi Kumar", Phone: "9876500001" }] },
    ]);

    const rooms = parseRoomsSheet(buf);
    expect(rooms).toHaveLength(2);
    expect(rooms[0]).toMatchObject({
      room_no: "101",
      floor: 1,
      capacity: 3,
      sharing_type: "Triple",
      base_rent: 8500,
    });
    expect(rooms[1]).toMatchObject({ room_no: "G1", floor: 0, capacity: 2, base_rent: 7000 });
  });

  it("returns nothing when the workbook has no Rooms sheet", () => {
    const buf = book([{ name: TENANTS_SHEET, rows: [{ Name: "Ravi Kumar" }] }]);
    expect(parseRoomsSheet(buf)).toEqual([]);
  });

  it("skips the blank rows left under the pre-filled ones", () => {
    const buf = book([
      {
        name: ROOMS_SHEET,
        rows: [
          { "Room No": "101", Capacity: 3 },
          { "Room No": "", Capacity: "" },
          { "Room No": "   ", Capacity: null },
        ],
      },
    ]);
    expect(parseRoomsSheet(buf)).toHaveLength(1);
  });

  it("keeps the owner's text for numbers it cannot read", () => {
    const buf = book([
      { name: ROOMS_SHEET, rows: [{ "Room No": "101", Capacity: "two", "Base Rent": "TBD" }] },
    ]);
    const [r] = parseRoomsSheet(buf);
    expect(Number.isNaN(r.capacity)).toBe(true);
    expect(r.raw_values?.capacity).toBe("two");
    expect(r.raw_values?.base_rent).toBe("TBD");
  });

  it("accepts the alternative headers an owner might type", () => {
    const buf = book([
      { name: ROOMS_SHEET, rows: [{ Room: "204", Beds: 4, Rent: 6000, Type: "Four sharing" }] },
    ]);
    expect(parseRoomsSheet(buf)[0]).toMatchObject({
      room_no: "204",
      capacity: 4,
      base_rent: 6000,
      sharing_type: "Four sharing",
    });
  });
});

describe("row numbers survive the blank rows the template leaves", () => {
  it("reports the line the owner is actually looking at", () => {
    const buf = book([
      {
        name: ROOMS_SHEET,
        rows: [
          { "Room No": "101", Capacity: 3 },
          { "Room No": "", Capacity: "" },
          { "Room No": "", Capacity: "" },
          { "Room No": "201", Capacity: 2 },
        ],
      },
    ]);

    const rooms = parseRoomsSheet(buf);
    expect(rooms.map((r) => r.room_no)).toEqual(["101", "201"]);
    // 101 is on sheet row 2; 201 is on row 5, not row 3.
    expect(rooms.map((r) => r.sheet_row)).toEqual([2, 5]);
  });
});

describe("row numbers against a real template, not a synthesised sheet", () => {
  // json_to_sheet writes empty-string cells for blank rows, so an array index
  // happens to line up. A real workbook drops genuinely empty rows entirely,
  // which is why the row number has to come from SheetJS's own __rowNum__.
  it("reports the true line when the sheet has genuinely empty rows", () => {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Room No", "Capacity"],
      ["101", 3],
    ]);
    // A room typed on line 5, with 3 and 4 left completely empty.
    XLSX.utils.sheet_add_aoa(sheet, [["201", 2]], { origin: "A5" });
    XLSX.utils.book_append_sheet(wb, sheet, ROOMS_SHEET);
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const rooms = parseRoomsSheet(buf);
    expect(rooms.map((r) => r.room_no)).toEqual(["101", "201"]);
    expect(rooms.map((r) => r.sheet_row)).toEqual([2, 5]);
  });
});
