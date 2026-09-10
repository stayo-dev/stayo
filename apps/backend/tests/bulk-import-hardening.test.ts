import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseTenantWorkbook, TENANTS_SHEET } from "@/lib/services/bulk-import/workbook-parser";

/**
 * Guards on what an uploaded file may contain.
 *
 * Every message names the real limit and what to do about it — an owner whose
 * file is refused must be able to act on the refusal.
 */

function withSheets(count: number): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Name: "Ravi Kumar", Phone: "9876500001" }]), TENANTS_SHEET);
  for (let i = 0; i < count; i++) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), `S${i}`);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function tenantSheet(rows: Record<string, unknown>[]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), TENANTS_SHEET);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("what an uploaded workbook may contain", () => {
  it("refuses a file with an absurd number of sheets", () => {
    expect(() => parseTenantWorkbook(withSheets(200), "t.xlsx")).toThrow(/sheets/i);
  });

  it("accepts an ordinary workbook of a few sheets", () => {
    expect(parseTenantWorkbook(withSheets(2), "t.xlsx")).toHaveLength(1);
  });

  it("refuses a sheet with an absurd number of columns", () => {
    const wide: Record<string, unknown> = { Name: "Ravi Kumar", Phone: "9876500001" };
    for (let i = 0; i < 500; i++) wide[`col_${i}`] = i;
    expect(() => parseTenantWorkbook(tenantSheet([wide]), "t.xlsx")).toThrow(/columns/i);
  });

  // Excel itself caps a cell at 32,767 characters, so the guard is set well
  // below that — a note of 5,000 characters is already not a note.
  it("refuses a cell far longer than any real value", () => {
    const rows = [{ Name: "Ravi Kumar", Phone: "9876500001", Notes: "x".repeat(5_000) }];
    expect(() => parseTenantWorkbook(tenantSheet(rows), "t.xlsx")).toThrow(/too long|too much text/i);
  });

  it("still refuses more rows than we import at once, naming the count", () => {
    const rows = Array.from({ length: 151 }, (_, i) => ({ Name: `Tenant ${i}`, Phone: `98765${String(i).padStart(5, "0")}` }));
    expect(() => parseTenantWorkbook(tenantSheet(rows), "t.xlsx")).toThrow(/151 rows/);
  });

  it("every refusal is one the owner can act on", () => {
    const cases: Array<() => unknown> = [
      () => parseTenantWorkbook(withSheets(200), "t.xlsx"),
      () => parseTenantWorkbook(tenantSheet([{ Name: "R", Phone: "1", Notes: "x".repeat(5_000) }]), "t.xlsx"),
    ];
    for (const run of cases) {
      try {
        run();
        throw new Error("expected a refusal");
      } catch (error: any) {
        expect(error.message).toContain("VALIDATION_ERROR");
        expect(error.message.length).toBeGreaterThan(40);
      }
    }
  });
});
