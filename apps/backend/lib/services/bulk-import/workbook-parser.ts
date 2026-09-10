import * as XLSX from "xlsx";
import { getLogger } from "../../logger";
import type { TenantImportRow } from "./types";

const logger = getLogger("bulk-import-validation");

export const MAX_IMPORT_ROWS = 150;

/** Sheet names in the generated workbook. Shared with the template builder. */
export const COVER_SHEET = "Read me";
export const ROOMS_SHEET = "Rooms";
export const TENANTS_SHEET = "Tenants";

/**
 * Which sheet holds the tenants.
 *
 * The generated template puts a locked cover sheet first, so taking
 * `SheetNames[0]` would parse the instructions as tenant rows — every row
 * invalid, for a reason no error message could explain. Owners also upload
 * their own single-sheet files, so fall back to the first sheet carrying a
 * recognisable tenant header.
 */
function pickTenantSheet(workbook: XLSX.WorkBook): string {
  const byName = workbook.SheetNames.find(
    (n) => n.trim().toLowerCase() === TENANTS_SHEET.toLowerCase()
  );
  if (byName) return byName;

  const skip = new Set([COVER_SHEET.toLowerCase(), ROOMS_SHEET.toLowerCase()]);
  const candidate = workbook.SheetNames.filter((n) => !skip.has(n.trim().toLowerCase())).find((n) => {
    const head = XLSX.utils.sheet_to_json<any>(workbook.Sheets[n], { header: 1 })[0] as string[] | undefined;
    if (!head) return false;
    const headers = head.map((h) => String(h || "").trim().toLowerCase());
    return (
      headers.some((h) => ["name", "full name"].includes(h)) &&
      headers.some((h) => ["phone", "phone number", "mobile"].includes(h))
    );
  });
  if (candidate) return candidate;

  throw new Error(
    `VALIDATION_ERROR: We couldn't find a "${TENANTS_SHEET}" sheet in this file. Download a fresh template and fill in the ${TENANTS_SHEET} sheet.`
  );
}

/**
 * Reads the first sheet of an uploaded workbook into tenant rows.
 *
 * Every failure it throws carries the `VALIDATION_ERROR:` prefix, so callers
 * can tell an owner-fixable problem ("this file has 200 rows") from a genuine
 * parse failure. The row-limit message once lacked it and was swallowed by the
 * catch below, telling an owner with a valid file that it was corrupt.
 */
export function parseTenantWorkbook(fileBuffer: Buffer, filename: string): TenantImportRow[] {
  try {
    const workbook = XLSX.read(fileBuffer, { type: "buffer", raw: true });

    if (!workbook.SheetNames.length) {
      throw new Error("VALIDATION_ERROR: Excel file is empty or has no sheets");
    }
    const sheetName = pickTenantSheet(workbook);

    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, {
      raw: true,
      defval: "",
    });

    if (jsonData.length > MAX_IMPORT_ROWS) {
      throw new Error(
        `VALIDATION_ERROR: This file has ${jsonData.length} rows. The most we can import at once is ${MAX_IMPORT_ROWS}. Split it into smaller files and import them one after another.`
      );
    }

    if (!jsonData || jsonData.length === 0) {
      throw new Error("VALIDATION_ERROR: No data rows found in the file");
    }

    return normalizeRows(jsonData);
  } catch (error: any) {
    if (error.message.includes("VALIDATION_ERROR")) {
      throw error;
    }
    logger.error("Failed to parse import file", {
      filename,
      error: String(error),
    });
    throw new Error("VALIDATION_ERROR: Failed to parse file. Please ensure it's a valid Excel or CSV file.");
  }
}

function normalizeRows(rawData: any[]): TenantImportRow[] {
  const RENT = ["Monthly Rent", "monthly_rent", "rent", "Rent"];
  const DEPOSIT = ["Deposit", "deposit", "Advance Deposit", "advance_deposit", "Security Deposit", "security_deposit"];
  const MONTHS = ["Agreement Months", "agreement_months", "agreement_duration_months"];
  const PAID = ["Amount Already Paid", "amount_already_paid", "amount_paid", "paid_amount"];
  return rawData.map((row) => ({
    raw_values: {
      monthly_rent: readCell(row, RENT) || undefined,
      security_deposit: readCell(row, DEPOSIT) || undefined,
      agreement_duration_months: readCell(row, MONTHS) || undefined,
      amount_paid: readCell(row, PAID) || undefined,
    },
    name: readCell(row, ["Full Name", "full_name", "name", "Name", "NAME"]),
    phone: readCell(row, ["Phone Number", "phone_number", "phone", "Phone", "PHONE", "mobile", "Mobile"]),
    email: readCell(row, ["Username", "Email Address", "Email Address_1", "email_address", "email", "Email", "EMAIL"]),
    room_no: readCell(row, ["Current Room", "current_room", "room_no", "room", "Room", "ROOM", "room_number"]),
    monthly_rent: parseImportNumber(readCell(row, ["Monthly Rent", "monthly_rent", "rent", "Rent"])),
    advance_deposit: parseImportNumber(readCell(row, ["Deposit", "deposit", "Advance Deposit", "advance_deposit", "Security Deposit", "security_deposit"])),
    security_deposit: parseImportNumber(readCell(row, ["Deposit", "deposit", "Advance Deposit", "advance_deposit", "Security Deposit", "security_deposit"])),
    joining_date: readCell(row, ["Joining Date", "joining_date", "Join Date", "join_date"]) || undefined,
    notes: readCell(row, ["Notes", "notes"]) || undefined,
    profile_type: readCell(row, ["profile_type", "type"]) || "STUDENT",
    emergency_contact: readCell(row, ["emergency_contact", "emergency"]) || undefined,
    gender: readCell(row, ["gender", "Gender"]) || undefined,
    agreement_duration_months: parseImportNumber(
      readCell(row, ["Agreement Months", "agreement_months", "agreement_duration_months"])
    ),
    amount_paid: parseImportNumber(
      readCell(row, ["Amount Already Paid", "amount_already_paid", "amount_paid", "paid_amount"])
    ),
    amount_includes_deposit: parseYesNo(
      readCell(row, ["Paid Includes Deposit", "paid_includes_deposit", "amount_includes_deposit"])
    ),
    // Uppercased so a sheet's "cash" lands in the same collections-report
    // bucket as the wizard's "CASH" — payment_method is a plain String
    // column, not an enum, so nothing else normalizes it.
    payment_method: readCell(row, ["Payment Method", "payment_method"]).toUpperCase() || undefined,
    payment_reference: readCell(row, ["Payment Reference", "payment_reference", "reference"]) || undefined,
  }));
}

function readCell(row: Record<string, any>, keys: string[]): string {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return String(row[key]).trim();
    }
  }
  return "";
}

/**
 * A number from a spreadsheet cell.
 *
 *   blank                    → undefined (use the default)
 *   8500, "8,500", "₹8,500",
 *   "Rs. 8,000", "INR 8000"  → the number
 *   anything else ("TBD",
 *   "N/A", "1 year", "8k")   → NaN, which validation reports to the owner
 *
 * The previous parser stripped every non-digit character, so "Rs. 8,000"
 * became ".8000" → 0.8 and "TBD" became "" → 0: a ₹0.80 rent, a ₹0 payment,
 * and "1 year" read as a one-month agreement, all previewed as clean.
 */
export function parseImportNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const text = String(value).trim();
  if (!text) return undefined;
  const cleaned = text
    .replace(/^(?:₹|rs\.?|inr)\s*/i, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "");
  return /^-?\d+(?:\.\d+)?$/.test(cleaned) ? Number(cleaned) : NaN;
}

function parseYesNo(value: any): boolean | undefined {
  const text = String(value ?? "").trim().toUpperCase();
  if (!text) return undefined;
  if (["YES", "Y", "TRUE", "1"].includes(text)) return true;
  if (["NO", "N", "FALSE", "0"].includes(text)) return false;
  return undefined;
}
