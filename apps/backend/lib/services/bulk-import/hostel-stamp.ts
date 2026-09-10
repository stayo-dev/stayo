import * as XLSX from "xlsx";
import { COVER_SHEET } from "./workbook-parser";
import { HOSTEL_ID_CELL } from "./template-builder";

/**
 * The hostel a generated workbook was built for.
 *
 * Every hostel has a room 101, so importing one hostel's workbook into
 * another would place tenants in the wrong rooms and report nothing wrong.
 * The stamp on the locked cover sheet is what makes that impossible.
 *
 * Returns null for a file the owner made themselves — it has no cover sheet,
 * and is still allowed.
 */
export function readHostelStamp(fileBuffer: Buffer): string | null {
  const workbook = XLSX.read(fileBuffer, { type: "buffer", raw: true });
  const name = workbook.SheetNames.find(
    (n) => n.trim().toLowerCase() === COVER_SHEET.toLowerCase()
  );
  if (!name) return null;

  const cell = workbook.Sheets[name][HOSTEL_ID_CELL];
  const value = String(cell?.v ?? "").trim();
  return value || null;
}
