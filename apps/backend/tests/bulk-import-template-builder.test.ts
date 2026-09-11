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

describe("row numbers stay true to the spreadsheet", () => {
  it("reports a tenant's own sheet row, even with the example row left in", async () => {
    const { buf } = await build();
    const wb = XLSX.read(buf as Buffer, { type: "buffer", raw: true });
    // Row 2 is the example; the owner's first tenant is on row 3.
    wb.Sheets[TENANTS_SHEET]["A3"] = { t: "s", v: "Ravi Kumar" };
    wb.Sheets[TENANTS_SHEET]["B3"] = { t: "s", v: "not-a-phone" };
    wb.Sheets[TENANTS_SHEET]["D3"] = { t: "s", v: "101" };
    wb.Sheets[TENANTS_SHEET]["!ref"] = "A1:O3";
    const edited = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const rows = parseTenantWorkbook(edited, "t.xlsx");
    expect(rows).toHaveLength(2);
    expect(rows[0].is_example).toBe(true);
    expect(rows[1].name).toBe("Ravi Kumar");
  });
});

describe("handing the owner their corrected file back", () => {
  // Small fixes are made on screen, not in Excel — which would leave the
  // spreadsheet on their machine out of step with what Stayo has, and
  // re-uploading it would undo the work.
  const CORRECTED = [
    {
      name: "Shiva Prakash Chidiri",
      phone: "8008046952",
      email: "",
      room_no: "101",
      monthly_rent: 8500,
      joining_date: "2026-01-05",
      security_deposit: 25500,
      maintenance_charge: 500,
      maintenance_type: "ONE_TIME",
      agreement_duration_months: 11,
      amount_paid: 76500,
      amount_includes_deposit: true,
      payment_method: "CASH",
      notes: "Already living here",
    },
  ];

  it("writes the real rows instead of the worked example", async () => {
    const buf = await buildImportWorkbook({ ...INPUT, tenants: CORRECTED });
    const rows = parseTenantWorkbook(buf as Buffer, "corrected.xlsx");

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Shiva Prakash Chidiri");
    expect(rows.some((r) => r.is_example)).toBe(false);
  });

  it("keeps every value the owner fixed", async () => {
    const buf = await buildImportWorkbook({ ...INPUT, tenants: CORRECTED });
    const [row] = parseTenantWorkbook(buf as Buffer, "corrected.xlsx");

    expect(row).toMatchObject({
      phone: "8008046952",
      room_no: "101",
      monthly_rent: 8500,
      joining_date: "2026-01-05",
      maintenance_charge: 500,
      maintenance_type: "ONE_TIME",
      agreement_duration_months: 11,
      amount_paid: 76500,
      payment_method: "CASH",
    });
    expect(row.amount_includes_deposit).toBe(true);
  });

  it("leaves a blank email blank, rather than writing the word undefined", async () => {
    const buf = await buildImportWorkbook({ ...INPUT, tenants: CORRECTED });
    const [row] = parseTenantWorkbook(buf as Buffer, "corrected.xlsx");
    expect(row.email).toBe("");
  });

  it("is still a working template — rooms, stamp and dropdown intact", async () => {
    const buf = await buildImportWorkbook({ ...INPUT, tenants: CORRECTED });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);

    expect(String(wb.getWorksheet(COVER_SHEET)!.getCell(HOSTEL_ID_CELL).value)).toBe(INPUT.hostel.id);
    expect(wb.getWorksheet(TENANTS_SHEET)!.getCell("D2").dataValidation?.formulae?.[0]).toBe("RoomList");
    expect(parseRoomsSheet(buf as Buffer).map((r) => r.room_no)).toEqual(["101", "G1"]);
  });

  it("still writes the example when there is nothing to correct", async () => {
    const buf = await buildImportWorkbook({ ...INPUT, tenants: [] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    expect(String(wb.getWorksheet(TENANTS_SHEET)!.getCell("A2").value)).toBe(EXAMPLE_ROW_NAME);
  });
});

describe("marking the problems in the owner's own sheet", () => {
  // Past a handful of errors, fixing them one at a time in a web form is
  // worse than fixing them in the spreadsheet the owner already knows. So the
  // file comes back with every problem marked where it happened.
  const WITH_PROBLEMS = [
    {
      name: "Shiva",
      phone: "98765",
      room_no: "1O1",
      joining_date: "May",
      problems: [
        { field: "phone", severity: "BLOCKER" as const, title: '"98765" isn\'t a 10-digit mobile number.', detail: 'Enter 10 digits.' },
        { field: "room_no", severity: "BLOCKER" as const, title: "Room 1O1 isn't in Sri Adithya Boys Hostel.", detail: 'Closest: 101.' },
      ],
    },
    {
      name: "Priya",
      phone: "9876500002",
      room_no: "101",
      problems: [
        { field: "joining_date", severity: "NEEDS_CHOICE" as const, title: "This tenant joined more than 2 years ago.", detail: "We'll bill the most recent 24 months." },
      ],
    },
  ];

  async function annotated() {
    const buf = await buildImportWorkbook({ ...INPUT, tenants: WITH_PROBLEMS });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    return { buf, sheet: wb.getWorksheet(TENANTS_SHEET)!, wb };
  }

  it("colours the exact cell each problem is about", async () => {
    const { sheet } = await annotated();
    // Phone is column B, room column D, on the first data row.
    expect((sheet.getCell("B2").fill as any)?.fgColor?.argb).toBe("FFFFD9D6");
    expect((sheet.getCell("D2").fill as any)?.fgColor?.argb).toBe("FFFFD9D6");
  });

  it("uses a different colour for something that only needs a decision", async () => {
    const { sheet } = await annotated();
    expect((sheet.getCell("F3").fill as any)?.fgColor?.argb).toBe("FFFFF0CC");
  });

  it("leaves cells with nothing wrong alone", async () => {
    const { sheet } = await annotated();
    expect(sheet.getCell("A2").fill).toBeUndefined();
    expect(sheet.getCell("B3").fill).toBeUndefined();
  });

  it("puts the full sentence in the cell, as a note", async () => {
    const { sheet } = await annotated();
    expect(String((sheet.getCell("B2").note as any)?.texts?.[0]?.text ?? sheet.getCell("B2").note)).toContain(
      "10-digit mobile number"
    );
  });

  it("adds a column saying what to fix, so nothing depends on hovering", async () => {
    const { sheet } = await annotated();
    expect(sheet.getCell("P1").value).toBe("What to fix");
    expect(String(sheet.getCell("P2").value)).toContain("Room 1O1 isn't in");
  });

  it("explains the colours on the cover sheet", async () => {
    const { wb } = await annotated();
    const cover = wb.getWorksheet(COVER_SHEET)!.getSheetValues().flat().map(String).join(" ");
    expect(cover).toContain("What the colours mean");
    expect(cover).toContain("upload this same file again");
  });

  it("adds no problem column at all when nothing is wrong", async () => {
    const buf = await buildImportWorkbook({
      ...INPUT,
      tenants: [{ name: "Fine", phone: "9876500001", room_no: "101" }],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    expect(wb.getWorksheet(TENANTS_SHEET)!.getCell("P1").value).toBeNull();
  });

  it("is still a file our own parser reads back", async () => {
    const { buf } = await annotated();
    const rows = parseTenantWorkbook(buf as Buffer, "marked.xlsx");
    expect(rows.map((r) => r.name)).toEqual(["Shiva", "Priya"]);
  });
});
