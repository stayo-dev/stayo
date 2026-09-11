import * as XLSX from "xlsx";
import { parseImportNumber, ROOMS_SHEET } from "./workbook-parser";

export type RoomImportRow = {
  room_no: string;
  floor?: number;
  capacity?: number;
  sharing_type?: string;
  base_rent?: number;
  /**
   * The row's real line in the spreadsheet. Blank rows are dropped, and the
   * template leaves 40 of them, so a position in the returned array is not
   * the line the owner is looking at.
   */
  sheet_row?: number;
  /** The owner's own text, so a cell we cannot read is quoted back as typed. */
  raw_values?: Partial<Record<"capacity" | "base_rent" | "floor", string>>;
};

function cell(row: Record<string, any>, keys: string[]): string {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return String(row[key]).trim();
    }
  }
  return "";
}

/**
 * The Rooms sheet of an import workbook: the rooms this hostel already has,
 * pre-filled by the template, plus any the owner added underneath.
 *
 * Blank rows are skipped — the template deliberately leaves empty rows below
 * the pre-filled ones for the owner to type into, and a spreadsheet tends to
 * carry a few more than were used.
 */
export function parseRoomsSheet(fileBuffer: Buffer): RoomImportRow[] {
  const workbook = XLSX.read(fileBuffer, { type: "buffer", raw: true });
  const name = workbook.SheetNames.find(
    (n) => n.trim().toLowerCase() === ROOMS_SHEET.toLowerCase()
  );
  if (!name) return [];

  const rows = XLSX.utils.sheet_to_json<any>(workbook.Sheets[name], { raw: true, defval: "" });

  return rows
    .map((row, index) => {
      const capacityText = cell(row, ["Capacity", "capacity", "Beds", "beds"]);
      const rentText = cell(row, ["Base Rent", "base_rent", "Rent", "rent"]);
      const floorText = cell(row, ["Floor", "floor"]);
      return {
        // SheetJS records each row's real line in `__rowNum__` (0-based, so
        // +1). Genuinely empty rows are dropped from the array entirely, and
        // the template leaves forty of them, so a position in the array is not
        // the line the owner is looking at.
        sheet_row: Number.isFinite(row.__rowNum__) ? Number(row.__rowNum__) + 1 : index + 2,
        room_no: cell(row, ["Room No", "Room", "room_no", "room", "Room Number", "room_number"]),
        floor: parseImportNumber(floorText),
        capacity: parseImportNumber(capacityText),
        sharing_type:
          cell(row, ["Sharing Type", "sharing_type", "Room Type", "room_type", "Type", "type"]) ||
          undefined,
        base_rent: parseImportNumber(rentText),
        raw_values: {
          capacity: capacityText || undefined,
          base_rent: rentText || undefined,
          floor: floorText || undefined,
        },
      };
    })
    .filter((r) => r.room_no !== "");
}
