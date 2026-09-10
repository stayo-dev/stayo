import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readHostelStamp } from "@/lib/services/bulk-import/hostel-stamp";
import { buildImportWorkbook } from "@/lib/services/bulk-import/template-builder";

const HOSTEL = { id: "11111111-1111-1111-1111-111111111111", name: "Sri Adithya Boys Hostel" };

describe("readHostelStamp", () => {
  it("reads the id a generated workbook was stamped with", async () => {
    const buf = await buildImportWorkbook({ hostel: HOSTEL, dueDay: 5, rooms: [], tenantCount: 0 });
    expect(readHostelStamp(buf)).toBe(HOSTEL.id);
  });

  it("returns null for a file the owner made themselves", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Name: "Ravi" }]), "Tenants");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    expect(readHostelStamp(buf)).toBeNull();
  });

  it("returns null when a cover sheet exists but carries no id", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Stayo"], ["Hostel ID", ""]]), "Read me");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    expect(readHostelStamp(buf)).toBeNull();
  });
});
