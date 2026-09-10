import { prisma } from "../../db";
import { hostelBillingPreferencesService } from "../hostel-billing-preferences-service";
import { buildIssue, type RowIssue } from "./issues";
import { formatImportDate, monthsBetween, parseImportDate } from "./dates";
import { indianPhoneKey, isSpreadsheetFormula, isValidImportEmail, normalizeImportPhone } from "./identity";
import { nearestRoomNumbers } from "./room-resolution";
import { parseTenantWorkbook } from "./workbook-parser";
import type {
  ImportDefaults,
  TenantImportRow,
  ValidatedRow,
  ValidationError,
  ValidationResult,
} from "./types";

/** Mirrors RENT_BACKFILL_CAP_MONTHS in onboarding-financials-service. */
const RENT_BACKFILL_CAP_MONTHS = 24;

/** Owner-facing column names, for issue copy. */
const FIELD_LABELS: Record<string, string> = {
  name: "name",
  email: "email",
  phone: "mobile number",
  room_no: "room",
  notes: "notes",
};

type NumberProblem = { field: string; label: string; value: unknown; message: string; hint: string };

/**
 * Numeric cells that are present but unusable. A blank cell is `undefined`
 * and falls back to a default; an unreadable one is `NaN` (see
 * `parseImportNumber`) and must be shown to the owner, never defaulted.
 */
function numberChecks(row: TenantImportRow): NumberProblem[] {
  const problems: NumberProblem[] = [];
  const money = "Enter the amount in rupees using digits, like 8500. A ₹ sign and commas are fine.";

  if (row.monthly_rent != null) {
    if (Number.isNaN(row.monthly_rent)) {
      problems.push({ field: "monthly_rent", label: "monthly rent", value: row.monthly_rent, message: "Monthly rent is not a number", hint: money });
    } else if (row.monthly_rent <= 0) {
      problems.push({ field: "monthly_rent", label: "monthly rent", value: row.monthly_rent, message: "Monthly rent must be more than 0", hint: "Monthly rent must be more than ₹0. Leave it blank to use the room's rent." });
    }
  }

  const deposit = row.security_deposit ?? row.advance_deposit;
  if (deposit != null && (Number.isNaN(deposit) || deposit < 0)) {
    problems.push({ field: "security_deposit", label: "deposit", value: deposit, message: "Deposit is not a valid amount", hint: `${money} Enter 0 if there is no deposit.` });
  }

  if (row.amount_paid != null && (Number.isNaN(row.amount_paid) || row.amount_paid < 0)) {
    problems.push({ field: "amount_paid", label: "amount already paid", value: row.amount_paid, message: "Amount already paid is not a valid amount", hint: `${money} Enter 0 if they have paid nothing yet.` });
  }

  const months = row.agreement_duration_months;
  if (months != null && (Number.isNaN(months) || !Number.isInteger(months) || months < 1 || months > 120)) {
    problems.push({ field: "agreement_duration_months", label: "agreement length", value: months, message: "Agreement length must be a whole number of months between 1 and 120", hint: "Enter the number of months as a whole number, like 11 — not \"1 year\"." });
  }

  return problems;
}

/**
 * Validates parsed import rows against the hostel's rooms, the owner's
 * existing tenants and invitations, and the hostel's billing defaults.
 *
 * Emits both the legacy free-text `errors`/`warnings` and structured
 * `issues` (see `./issues`) — the API still serves the former while the
 * owner-facing review queue is built on the latter.
 */
export class BulkImportValidationService {
  async parseFile(fileBuffer: Buffer, filename: string): Promise<TenantImportRow[]> {
    return parseTenantWorkbook(fileBuffer, filename);
  }

  /**
   * @param pendingRooms rooms the same workbook's Rooms sheet will create at
   *   confirm. Tenants must be allowed to reference them: the template's own
   *   instructions tell the owner to add a missing room on the Rooms sheet and
   *   then use it, so validating against the database alone would reject the
   *   exact flow we ask for.
   */
  async validateRows(
    rows: TenantImportRow[],
    hostelId: string,
    ownerId: string,
    importDefaults: ImportDefaults = {},
    pendingRooms: Array<{ room_no: string; capacity?: number; base_rent?: number }> = []
  ): Promise<ValidationResult> {
    const validatedRows: ValidatedRow[] = [];
    const existingPhones = await this.getExistingPhones(ownerId);
    const existingEmails = await this.getExistingEmails(ownerId);
    const savedRooms = await this.getHostelRooms(hostelId);
    const savedRoomNumbers = new Set(savedRooms.map((r) => r.room_no.trim().toUpperCase()));
    const hostelRooms = [
      ...savedRooms,
      ...pendingRooms
        .filter((r) => !savedRoomNumbers.has(String(r.room_no).trim().toUpperCase()))
        .map((r) => ({
          id: `pending:${String(r.room_no).trim()}`,
          room_no: String(r.room_no).trim(),
          is_active: true,
          capacity: Number(r.capacity ?? 1),
          base_rent: r.base_rent ?? null,
          occupied_count: 0,
          reserved_count: 0,
        })),
    ];
    const hostel = await prisma.hostels.findUnique({ where: { id: hostelId }, select: { name: true } });
    const hostelName = hostel?.name ?? "this hostel";
    const billingDefaults = await hostelBillingPreferencesService.getBillingDefaults(hostelId);
    // Keyed to the row number that first used the value, so a duplicate can
    // tell the owner which row it repeats.
    const phonesSeen = new Map<string, number>();
    const emailsSeen = new Map<string, number>();
    const roomAssignmentsSeen = new Map<string, number>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    /** Up to three other active rooms that still have a free bed. */
    const roomsWithSpace = (exceptRoomId?: string) =>
      hostelRooms
        .filter((r) => r.is_active && r.id !== exceptRoomId)
        .filter((r) => r.occupied_count + r.reserved_count + (roomAssignmentsSeen.get(r.id) || 0) < r.capacity)
        .slice(0, 3)
        .map((r) => r.room_no);
    const defaultJoiningDate = importDefaults.joining_date || formatImportDate(new Date());
    const defaultMaintenanceType = importDefaults.maintenance_type || billingDefaults.maintenance_type;
    const defaultMaintenanceCharge = defaultMaintenanceType === "NONE"
      ? 0
      : (importDefaults.maintenance_charge ?? billingDefaults.maintenance_charge);
    const defaultAdvanceDeposit = importDefaults.security_deposit ?? importDefaults.advance_deposit ?? billingDefaults.security_deposit ?? billingDefaults.advance_deposit;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;
      // The template's own example row, left in place so the row numbers the
      // owner sees match their spreadsheet.
      if (row.is_example) continue;
      const errors: ValidationError[] = [];
      const warnings: string[] = [];
      const issues: RowIssue[] = [];
      let isDuplicate = false;
      let duplicateReason: string | undefined;
      let duplicateIssue: RowIssue | undefined;

      if (!row.name || row.name.length < 2) {
        errors.push({
          row: rowNumber,
          field: "name",
          message: "Name is required and must be at least 2 characters",
          value: row.name,
        });
        issues.push(buildIssue("NAME_MISSING", rowNumber, { value: row.name }));
      }

      const normalizedPhone = normalizeImportPhone(row.phone);
      if (!normalizedPhone) {
        errors.push({
          row: rowNumber,
          field: "phone",
          message: "Valid phone number is required (10 digits)",
          value: row.phone,
        });
        issues.push(buildIssue("PHONE_INVALID", rowNumber, { value: row.phone }));
      } else {
        const phoneKey = indianPhoneKey(normalizedPhone);
        if (existingPhones.has(phoneKey)) {
          isDuplicate = true;
          duplicateReason = `Phone number ${normalizedPhone} already exists in system`;
          duplicateIssue = buildIssue("DUPLICATE_IN_SYSTEM", rowNumber, {});
        } else if (phonesSeen.has(phoneKey)) {
          isDuplicate = true;
          duplicateReason = `Phone number ${normalizedPhone} appears multiple times in this file`;
          duplicateIssue = buildIssue("DUPLICATE_IN_FILE", rowNumber, { otherRows: [phonesSeen.get(phoneKey)!] });
        } else {
          phonesSeen.set(phoneKey, rowNumber);
        }
      }

      const normalizedEmail = String(row.email || "").trim().toLowerCase();
      if (!normalizedEmail) {
        errors.push({
          row: rowNumber,
          field: "email",
          message: "Email is required",
          value: row.email,
        });
        issues.push(buildIssue("EMAIL_INVALID", rowNumber, { value: row.email }));
      } else if (!isValidImportEmail(normalizedEmail)) {
        errors.push({
          row: rowNumber,
          field: "email",
          message: "Invalid email format",
          value: row.email,
        });
        issues.push(buildIssue("EMAIL_INVALID", rowNumber, { value: row.email }));
      } else if (existingEmails.has(normalizedEmail)) {
        isDuplicate = true;
        duplicateReason = `Email ${normalizedEmail} already exists in system or active invitations`;
        duplicateIssue ??= buildIssue("DUPLICATE_IN_SYSTEM", rowNumber, {});
      } else if (emailsSeen.has(normalizedEmail)) {
        isDuplicate = true;
        duplicateReason = `Email ${normalizedEmail} appears multiple times in this file`;
        duplicateIssue ??= buildIssue("DUPLICATE_IN_FILE", rowNumber, { otherRows: [emailsSeen.get(normalizedEmail)!] });
      } else {
        emailsSeen.set(normalizedEmail, rowNumber);
      }
      if (duplicateIssue) issues.push(duplicateIssue);

      for (const [field, value] of Object.entries({
        name: row.name,
        email: row.email,
        phone: row.phone,
        room_no: row.room_no,
        notes: row.notes,
      })) {
        if (isSpreadsheetFormula(value)) {
          errors.push({
            row: rowNumber,
            field,
            message: "Spreadsheet formulas are not allowed in import values",
            value,
          });
          issues.push(buildIssue("FORMULA_IN_CELL", rowNumber, { fieldLabel: FIELD_LABELS[field] ?? field }));
        }
      }

      let roomForRow: any = null;
      if (!row.room_no) {
        errors.push({
          row: rowNumber,
          field: "room_no",
          message: "Room number is required",
          value: row.room_no,
        });
        issues.push(buildIssue("ROOM_MISSING", rowNumber));
      } else {
        roomForRow = hostelRooms.find((r) => r.room_no === row.room_no);
        if (!roomForRow) {
          errors.push({
            row: rowNumber,
            field: "room_no",
            message: `Room ${row.room_no} not found in hostel`,
            value: row.room_no,
          });
          issues.push(buildIssue("ROOM_NOT_FOUND", rowNumber, {
            roomNo: row.room_no,
            hostelName,
            nearestRooms: nearestRoomNumbers(row.room_no, hostelRooms),
          }));
        } else if (!roomForRow.is_active) {
          // createInvitation only accepts active rooms, so this was a warning
          // at preview and a "Room not found" failure at confirm.
          errors.push({
            row: rowNumber,
            field: "room_no",
            message: `Room ${row.room_no} is inactive`,
            value: row.room_no,
          });
          issues.push(buildIssue("ROOM_INACTIVE", rowNumber, {
            roomNo: row.room_no,
            hostelName,
            roomsWithSpace: roomsWithSpace(roomForRow.id),
          }));
        } else if ((!roomForRow.base_rent || roomForRow.base_rent <= 0) && row.monthly_rent == null) {
          // A room with no base rent only matters when the sheet doesn't give
          // this tenant's rent either — otherwise the row imports fine.
          errors.push({
            row: rowNumber,
            field: "room_no",
            message: `Room ${row.room_no} does not have rent configured`,
            value: row.room_no,
          });
          issues.push(buildIssue("ROOM_NO_RENT", rowNumber, { roomNo: row.room_no }));
        }
      }

      for (const check of numberChecks(row)) {
        errors.push({ row: rowNumber, field: check.field, message: check.message, value: check.value });
        issues.push(buildIssue("NUMBER_INVALID", rowNumber, {
          // The owner's own text if we have it; never "NaN".
          value: row.raw_values?.[check.field as keyof NonNullable<TenantImportRow["raw_values"]>]
            ?? (Number.isNaN(check.value as number) ? "" : String(check.value)),
          fieldLabel: check.label,
          hint: check.hint,
        }));
      }

      if (!parseImportDate(defaultJoiningDate)) {
        errors.push({
          row: rowNumber,
          field: "joining_date",
          message: "Invalid default joining date — use DD/MM/YYYY, e.g. 05/01/2026 for 5 January 2026",
          value: defaultJoiningDate,
        });
        issues.push(buildIssue("DATE_UNREADABLE", rowNumber, { value: defaultJoiningDate }));
      }

      const rowJoiningDate = row.joining_date || defaultJoiningDate;
      const parsedJoiningDate = parseImportDate(rowJoiningDate);
      if (row.joining_date && !parsedJoiningDate) {
        errors.push({
          row: rowNumber,
          field: "joining_date",
          message: "Invalid joining date — use DD/MM/YYYY, e.g. 05/01/2026 for 5 January 2026",
          value: row.joining_date,
        });
        issues.push(buildIssue("DATE_UNREADABLE", rowNumber, { value: row.joining_date }));
      } else if (parsedJoiningDate) {
        // Billing generates one rent month per month from the joining month
        // to the current month *inclusive*, and truncates once that count
        // exceeds RENT_BACKFILL_CAP_MONTHS — so compare the billed count, not
        // the gap between the dates (which is one smaller).
        const billedMonths = monthsBetween(parsedJoiningDate, today) + 1;
        if (billedMonths > RENT_BACKFILL_CAP_MONTHS) {
          const firstBilled = new Date(today.getFullYear(), today.getMonth() - (RENT_BACKFILL_CAP_MONTHS - 1), 1);
          issues.push(buildIssue("BACKFILL_CAPPED", rowNumber, {
            monthsElapsed: billedMonths,
            cappedTo: RENT_BACKFILL_CAP_MONTHS,
            firstBilledMonth: firstBilled.toLocaleString("en-IN", { month: "long", year: "numeric" }),
          }));
          warnings.push("Historical joining date requires owner confirmation before invitations are sent");
        } else if (parsedJoiningDate < today) {
          warnings.push("Historical joining date requires owner confirmation before invitations are sent");
        }
      }

      // Amount already paid needs a payment method to be recorded against
      // dues correctly. Without this check the row previews as clean and
      // then hard-fails at execute time inside createInvitation.
      if ((row.amount_paid ?? 0) > 0 && !row.payment_method) {
        errors.push({
          row: rowNumber,
          field: "payment_method",
          message: "A payment method is required when an amount already paid is entered",
          value: row.payment_method,
        });
        issues.push(buildIssue("PAYMENT_METHOD_MISSING", rowNumber, { amountPaid: row.amount_paid }));
      }

      // Capacity is decided last, after every per-row check that can still
      // push an error (including joining-date validation above) has run. A
      // duplicate row, or one that already failed validation for any reason,
      // will never be imported — so it must neither claim a bed nor be told
      // the room is full. Deciding this any earlier in the loop iteration
      // let a later, unrelated field failure (e.g. an unreadable joining
      // date) falsely consume a bed and push a legitimate later row into a
      // false "capacity would be exceeded". Only active rooms compete for
      // capacity, matching the room-existence/is_active checks above.
      if (roomForRow && roomForRow.is_active) {
        const currentOccupancy = roomForRow.occupied_count + roomForRow.reserved_count;
        const assignmentsInFile = roomAssignmentsSeen.get(roomForRow.id) || 0;
        const rowCanImport = !isDuplicate && errors.length === 0;
        if (rowCanImport) {
          if (currentOccupancy + assignmentsInFile + 1 > roomForRow.capacity) {
            errors.push({
              row: rowNumber,
              field: "room_no",
              message: `Room ${row.room_no} capacity would be exceeded (${currentOccupancy + assignmentsInFile + 1}/${roomForRow.capacity})`,
              value: row.room_no,
            });
            issues.push(buildIssue("ROOM_CAPACITY_EXCEEDED", rowNumber, {
              roomNo: row.room_no,
              capacity: roomForRow.capacity,
              occupied: currentOccupancy + assignmentsInFile,
              roomsWithSpace: roomsWithSpace(roomForRow.id),
            }));
          } else {
            roomAssignmentsSeen.set(roomForRow.id, assignmentsInFile + 1);
          }
        }
      }

      validatedRows.push({
        row: rowNumber,
        data: {
          ...row,
          phone: normalizedPhone || row.phone,
          email: normalizedEmail,
          room_id: roomForRow?.id,
          monthly_rent: row.monthly_rent ?? (roomForRow?.base_rent ? Number(roomForRow.base_rent) : undefined),
          advance_deposit: row.security_deposit ?? row.advance_deposit ?? defaultAdvanceDeposit,
          security_deposit: row.security_deposit ?? row.advance_deposit ?? defaultAdvanceDeposit,
          maintenance_charge: defaultMaintenanceCharge,
          maintenance_type: defaultMaintenanceType,
          agreement_duration_months: row.agreement_duration_months,
          amount_paid: row.amount_paid,
          amount_includes_deposit: row.amount_includes_deposit ?? true,
          payment_method: row.payment_method,
          payment_reference: row.payment_reference,
          // Stored as ISO, from the date the validator parsed. createInvitation
          // re-reads it with `new Date()`, which takes "05/01/2026" as 1 May
          // (US order), cannot read "13/01/2026" at all, and turns an Excel
          // serial into the year 46026 — so the raw cell text must never
          // reach it.
          joining_date: parsedJoiningDate
            ? formatImportDate(parsedJoiningDate)
            : row.joining_date || defaultJoiningDate,
          rent_source: row.monthly_rent != null ? "SHEET" : "ROOM_CONFIG",
        },
        errors,
        warnings,
        issues,
        isDuplicate,
        duplicateReason,
      });
    }

    const validRows = validatedRows.filter((r) => r.errors.length === 0 && !r.isDuplicate);
    const invalidRows = validatedRows.filter((r) => r.errors.length > 0);
    const duplicates = validatedRows.filter((r) => r.isDuplicate);
    const allIssues = validatedRows.flatMap((r) => r.issues);

    return {
      totalRows: rows.length,
      validRows,
      invalidRows,
      duplicates,
      summary: {
        valid: validRows.length,
        invalid: invalidRows.length,
        duplicates: duplicates.length,
        warnings: validatedRows.reduce((sum, r) => sum + r.warnings.length, 0),
        blockers: allIssues.filter((i) => i.severity === "BLOCKER").length,
        choices: allIssues.filter((i) => i.severity === "NEEDS_CHOICE").length,
      },
    };
  }

  private async getExistingPhones(ownerId: string): Promise<Set<string>> {
    const profiles = await prisma.profile.findMany({
      where: {
        owner_id: ownerId,
        role: "TENANT",
        phone: { not: null },
      },
      select: { phone: true },
    });
    const invited = await prisma.tenant_invitations.findMany({
      where: {
        owner_id: ownerId,
        status: { in: ["PENDING", "OPENED", "ACTIVATION_STARTED"] },
        phone: { not: null },
      },
      select: { phone: true },
    });
    // Keyed by last 10 digits: profiles store bare digits, invitations E.164.
    return new Set(
      [...profiles.map((p: any) => p.phone), ...invited.map((i: any) => i.phone)]
        .map(indianPhoneKey)
        .filter((key) => key.length === 10)
    );
  }

  private async getExistingEmails(ownerId: string): Promise<Set<string>> {
    const profiles = await prisma.profile.findMany({
      where: {
        owner_id: ownerId,
        role: "TENANT",
      },
      select: { email: true },
    });
    const invited = await prisma.tenant_invitations.findMany({
      where: {
        owner_id: ownerId,
        status: { in: ["PENDING", "OPENED", "ACTIVATION_STARTED"] },
      },
      select: { email: true },
    });
    return new Set([
      ...profiles.map((p: any) => p.email.toLowerCase()),
      ...invited.map((i: any) => String(i.email || "").toLowerCase()).filter(Boolean),
    ]);
  }

  private async getHostelRooms(hostelId: string): Promise<Array<{ id: string; room_no: string; is_active: boolean; capacity: number; base_rent: number | null; occupied_count: number; reserved_count: number }>> {
    const hostelRooms = await prisma.rooms.findMany({
      where: { hostel_id: hostelId },
      select: {
        id: true,
        room_no: true,
        is_active: true,
        capacity: true,
        base_rent: true,
        _count: {
          select: {
            room_allocations: {
              where: { is_active: true, end_date: null, tenant: { status: "ACTIVE" } }
            },
            tenant_invitation_reservations: {
              where: { status: "ACTIVE", expires_at: { gt: new Date() } },
            },
          }
        }
      },
    });
    return hostelRooms.map((room: any) => ({
      id: room.id,
      room_no: room.room_no,
      is_active: room.is_active,
      capacity: room.capacity,
      base_rent: room.base_rent,
      occupied_count: room._count?.room_allocations || 0,
      reserved_count: room._count?.tenant_invitation_reservations || 0,
    }));
  }
}

export const bulkImportValidationService = new BulkImportValidationService();
