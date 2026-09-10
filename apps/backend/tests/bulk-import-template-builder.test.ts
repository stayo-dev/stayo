import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { buildImportWorkbook, HOSTEL_ID_CELL } from "@/lib/services/bulk-import/template-builder";
import { EXAMPLE_ROW_NAME, parseTenantWorkbook } from "@/lib/services/bulk-import/workbook-parser";
import { parseRoomsSheet } from "@/lib/services/bulk-import/rooms-sheet";
import { COVER_SHEET, ROOMS_SHEET, TENANTS_SHEET } from "@/lib/services/bulk-import/workbook-parser";

const INPUT = {
  hostel: { id: "11111111-1111-1111-1111-111111111111", name: "Sri Adithya Boys Hostel" },
  dueDay: 5,
  rooms: [
    { room_no: "101", floor: 1, capacity: 3, room_type: "Triple", base_rent: 8500, occupied_count: 1 },
    { room_no: "G1", floor: 0, capacity: 2, room_type: "Double", base_rent: 7000, occupied_count: 0 },
  ],
  tenantCount: 5,
};

async function build() {
  const buf = await buildImportWorkbook(INPUT);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  return { buf, wb };
}

describe("the generated workbook", () => {
  it("has the three sheets, cover first", async () => {
    const { wb } = await build();
    expect(wb.worksheets.map((w) => w.name)).toEqual([COVER_SHEET, ROOMS_SHEET, TENANTS_SHEET]);
  });

  it("stamps the hostel id where upload can read it", async () => {
    const { wb } = await build();
    expect(String(wb.getWorksheet(COVER_SHEET)!.getCell(HOSTEL_ID_CELL).value)).toBe(INPUT.hostel.id);
  });

  it("keeps the stamp in B2, the cell already-downloaded workbooks use", () => {
    // Asserting the literal cell, not just that writer and reader agree:
    // moving it would silently break every workbook an owner already has.
    expect(HOSTEL_ID_CELL).toBe("B2");
  });

  it("names the hostel and its due day for the owner", async () => {
    const { wb } = await build();
    const text = wb.getWorksheet(COVER_SHEET)!.getSheetValues().flat().map(String).join(" ");
    expect(text).toContain("Sri Adithya Boys Hostel");
    // Not a bare "5" — that matches the date example too.
    expect(text).toMatch(/due .*\b5\b/i);
  });

  it("asks for dates in Indian format and never leads with ISO", async () => {
    const { wb } = await build();
    const text = wb.getWorksheet(COVER_SHEET)!.getSheetValues().flat().map(String).join(" ");
    expect(text).toContain("DD/MM/YYYY");
    expect(text).toContain("5 January 2026");
    expect(text).not.toContain("YYYY-MM-DD");
  });

  it("pre-fills the hostel's existing rooms", async () => {
    const { buf } = await build();
    const rooms = parseRoomsSheet(buf as Buffer);
    expect(rooms.map((r) => r.room_no)).toEqual(["101", "G1"]);
    expect(rooms[0]).toMatchObject({ capacity: 3, base_rent: 8500, floor: 1 });
  });

  it("leaves blank rows under the pre-filled rooms to add more", async () => {
    const { wb } = await build();
    expect(wb.getWorksheet(ROOMS_SHEET)!.rowCount).toBeGreaterThan(INPUT.rooms.length + 1);
  });

  it("binds the Tenants room column to a dropdown of the rooms", async () => {
    const { wb } = await build();
    const cell = wb.getWorksheet(TENANTS_SHEET)!.getCell("D2");
    expect(cell.dataValidation?.type).toBe("list");
    // The dropdown must actually point at the room list — a list validation
    // with no source is an empty dropdown, which looks fine until it is used.
    expect(cell.dataValidation?.formulae?.[0]).toBe("RoomList");
    const ranges = wb.definedNames.getRanges("RoomList").ranges;
    expect(ranges.length).toBeGreaterThan(0);
    expect(String(ranges[0])).toContain(ROOMS_SHEET);
  });

  it("covers the blank rows too, so a room the owner adds appears in the dropdown", async () => {
    const { wb } = await build();
    const range = String(wb.definedNames.getRanges("RoomList").ranges[0]);
    const lastRow = Number(range.split("$").pop());
    expect(lastRow).toBeGreaterThan(INPUT.rooms.length + 1);
  });

  it("offers maintenance type, paid-includes-deposit and payment method as dropdowns", async () => {
    const { wb } = await build();
    const sheet = wb.getWorksheet(TENANTS_SHEET)!;
    const at = (ref: string) => sheet.getCell(ref).dataValidation?.formulae?.[0] ?? "";
    expect(at("I2")).toContain("MONTHLY");
    expect(at("L2")).toContain("YES");
    expect(at("M2")).toContain("CASH");
  });

  it("puts each dropdown on the column its header names", async () => {
    const { wb } = await build();
    const header = (wb.getWorksheet(TENANTS_SHEET)!.getRow(1).values as any[]).map((v) => String(v ?? ""));
    // values is 1-based, so index N is column N.
    expect(header[4]).toBe("Room");
    expect(header[9]).toBe("Maintenance Type");
    expect(header[12]).toBe("Paid Includes Deposit");
    expect(header[13]).toBe("Payment Method");
  });

  it("round-trips through our own parser", async () => {
    const { buf } = await build();
    const wb = XLSX.read(buf as Buffer, { type: "buffer", raw: true });
    expect(wb.SheetNames).toContain(TENANTS_SHEET);
  });

  it("works for a hostel with no rooms yet", async () => {
    const buf = await buildImportWorkbook({ ...INPUT, rooms: [], tenantCount: 0 });
    expect(parseRoomsSheet(buf as Buffer)).toEqual([]);
  });
});

describe("the worked example row", () => {
  it("is written into the sheet, so the owner can see the shape of a row", async () => {
    const { wb } = await build();
    expect(String(wb.getWorksheet(TENANTS_SHEET)!.getCell("A2").value)).toBe(EXAMPLE_ROW_NAME);
  });

  it("is not imported as a tenant when the owner forgets to delete it", async () => {
    const { buf } = await build();
    expect(() => parseTenantWorkbook(buf as Buffer, "t.xlsx")).toThrow(/any tenants in it yet/);
  });

  it("becomes a real tenant once the owner types over the name", async () => {
    const { buf } = await build();
    const wb = XLSX.read(buf as Buffer, { type: "buffer", raw: true });
    wb.Sheets[TENANTS_SHEET]["A2"] = { t: "s", v: "Ravi Kumar" };
    const edited = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const rows = parseTenantWorkbook(edited, "t.xlsx");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Ravi Kumar");
  });
});
