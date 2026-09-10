import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseTenantWorkbook, TENANTS_SHEET } from "@/lib/services/bulk-import/workbook-parser";

/**
 * Which sheet of an uploaded workbook holds the tenants.
 *
 * The generated template puts a locked cover sheet first, so reading
 * `SheetNames[0]` would parse the instructions as tenant rows — every row
 * invalid, for a reason no error message could explain.
 */

function book(sheets: Array<{ name: string; rows: Record<string, unknown>[] }>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const TENANT_ROWS = [{ Name: "Ravi Kumar", Phone: "9876500001", Email: "r@example.com", Room: "101" }];

describe("choosing the sheet to read", () => {
  it("reads the Tenants sheet even when a cover sheet comes first", () => {
    const buf = book([
      { name: "Read me", rows: [{ Hostel: "Sri Adithya Boys Hostel" }] },
      { name: "Rooms", rows: [{ Room: "101", Capacity: 3 }] },
      { name: TENANTS_SHEET, rows: TENANT_ROWS },
    ]);

    const rows = parseTenantWorkbook(buf, "t.xlsx");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Ravi Kumar");
  });

  it("matches the sheet name case-insensitively", () => {
    const buf = book([
      { name: "Read me", rows: [{ Hostel: "X" }] },
      { name: "TENANTS", rows: TENANT_ROWS },
    ]);
    expect(parseTenantWorkbook(buf, "t.xlsx")[0].name).toBe("Ravi Kumar");
  });

  it("still reads a plain single-sheet file the owner made themselves", () => {
    const buf = book([{ name: "Sheet1", rows: TENANT_ROWS }]);
    expect(parseTenantWorkbook(buf, "t.xlsx")[0].name).toBe("Ravi Kumar");
  });

  it("does not mistake the Rooms sheet for tenants", () => {
    const buf = book([
      { name: "Rooms", rows: [{ Room: "101", Capacity: 3 }] },
      { name: TENANTS_SHEET, rows: TENANT_ROWS },
    ]);
    expect(parseTenantWorkbook(buf, "t.xlsx")[0].name).toBe("Ravi Kumar");
  });

  it("says which sheet it wanted when there is no tenant data anywhere", () => {
    const buf = book([{ name: "Read me", rows: [{ Hostel: "X" }] }]);
    expect(() => parseTenantWorkbook(buf, "t.xlsx")).toThrow(/Tenants/);
  });
});
