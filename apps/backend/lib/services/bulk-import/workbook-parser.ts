import * as XLSX from "xlsx";
import { getLogger } from "../../logger";
import type { TenantImportRow } from "./types";

const logger = getLogger("bulk-import-validation");

export const MAX_IMPORT_ROWS = 150;

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
    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      throw new Error("VALIDATION_ERROR: Excel file is empty or has no sheets");
    }

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
  return rawData.map((row) => ({
    name: readCell(row, ["Full Name", "full_name", "name", "Name", "NAME"]),
    phone: readCell(row, ["Phone Number", "phone_number", "phone", "Phone", "PHONE", "mobile", "Mobile"]),
    email: readCell(row, ["Username", "Email Address", "Email Address_1", "email_address", "email", "Email", "EMAIL"]),
    room_no: readCell(row, ["Current Room", "current_room", "room_no", "room", "Room", "ROOM", "room_number"]),
    monthly_rent: parseNumber(readCell(row, ["Monthly Rent", "monthly_rent", "rent", "Rent"])),
    advance_deposit: parseNumber(readCell(row, ["Deposit", "deposit", "Advance Deposit", "advance_deposit", "Security Deposit", "security_deposit"])),
    security_deposit: parseNumber(readCell(row, ["Deposit", "deposit", "Advance Deposit", "advance_deposit", "Security Deposit", "security_deposit"])),
    joining_date: readCell(row, ["Joining Date", "joining_date", "Join Date", "join_date"]) || undefined,
    notes: readCell(row, ["Notes", "notes"]) || undefined,
    profile_type: readCell(row, ["profile_type", "type"]) || "STUDENT",
    emergency_contact: readCell(row, ["emergency_contact", "emergency"]) || undefined,
    gender: readCell(row, ["gender", "Gender"]) || undefined,
    agreement_duration_months: parseNumber(
      readCell(row, ["Agreement Months", "agreement_months", "agreement_duration_months"])
    ),
    amount_paid: parseNumber(
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

function parseNumber(value: any): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const num = Number(String(value).replace(/[^0-9.-]/g, ""));
  return isNaN(num) ? undefined : num;
}

function parseYesNo(value: any): boolean | undefined {
  const text = String(value ?? "").trim().toUpperCase();
  if (!text) return undefined;
  if (["YES", "Y", "TRUE", "1"].includes(text)) return true;
  if (["NO", "N", "FALSE", "0"].includes(text)) return false;
  return undefined;
}
