import { prisma } from "../../db";
import { hostelBillingPreferencesService } from "../hostel-billing-preferences-service";
import { buildIssue, type RowIssue } from "./issues";
import { formatImportDate, monthsBetween, parseImportDate } from "./dates";
import { isSpreadsheetFormula, isValidImportEmail, normalizeImportPhone } from "./identity";
import { nearestRoomNumbers } from "./room-resolution";
import { parseTenantWorkbook } from "./workbook-parser";
import type {
  ImportDefaults,
  TenantImportRow,
  ValidatedRow,
  ValidationError,
  ValidationResult,
} from "./types";

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

  async validateRows(
    rows: TenantImportRow[],
    hostelId: string,
    ownerId: string,
    importDefaults: ImportDefaults = {}
  ): Promise<ValidationResult> {
    const validatedRows: ValidatedRow[] = [];
    const existingPhones = await this.getExistingPhones(ownerId);
    const existingEmails = await this.getExistingEmails(ownerId);
    const hostelRooms = await this.getHostelRooms(hostelId);
    const hostel = await prisma.hostels.findUnique({ where: { id: hostelId }, select: { name: true } });
    const hostelName = hostel?.name ?? "this hostel";
    const billingDefaults = await hostelBillingPreferencesService.getBillingDefaults(hostelId);
    const phonesSeen = new Set<string>();
    const emailsSeen = new Set<string>();
    const roomAssignmentsSeen = new Map<string, number>();
    const defaultJoiningDate = importDefaults.joining_date || formatImportDate(new Date());
    const defaultMaintenanceType = importDefaults.maintenance_type || billingDefaults.maintenance_type;
    const defaultMaintenanceCharge = defaultMaintenanceType === "NONE"
      ? 0
      : (importDefaults.maintenance_charge ?? billingDefaults.maintenance_charge);
    const defaultAdvanceDeposit = importDefaults.security_deposit ?? importDefaults.advance_deposit ?? billingDefaults.security_deposit ?? billingDefaults.advance_deposit;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;
      const errors: ValidationError[] = [];
      const warnings: string[] = [];
      const issues: RowIssue[] = [];
      let isDuplicate = false;
      let duplicateReason: string | undefined;

      if (!row.name || row.name.length < 2) {
        errors.push({
          row: rowNumber,
          field: "name",
          message: "Name is required and must be at least 2 characters",
          value: row.name,
        });
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
        if (existingPhones.has(normalizedPhone)) {
          isDuplicate = true;
          duplicateReason = `Phone number ${normalizedPhone} already exists in system`;
        } else if (phonesSeen.has(normalizedPhone)) {
          isDuplicate = true;
          duplicateReason = `Phone number ${normalizedPhone} appears multiple times in this file`;
        } else {
          phonesSeen.add(normalizedPhone);
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
      } else if (!isValidImportEmail(normalizedEmail)) {
        errors.push({
          row: rowNumber,
          field: "email",
          message: "Invalid email format",
          value: row.email,
        });
      } else if (existingEmails.has(normalizedEmail)) {
        isDuplicate = true;
        duplicateReason = `Email ${normalizedEmail} already exists in system or active invitations`;
      } else if (emailsSeen.has(normalizedEmail)) {
        isDuplicate = true;
        duplicateReason = `Email ${normalizedEmail} appears multiple times in this file`;
      } else {
        emailsSeen.add(normalizedEmail);
      }

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
          warnings.push(`Room ${row.room_no} is inactive`);
        } else if (!roomForRow.base_rent || roomForRow.base_rent <= 0) {
          errors.push({
            row: rowNumber,
            field: "room_no",
            message: `Room ${row.room_no} does not have rent configured`,
            value: row.room_no,
          });
        }
      }

      if (!parseImportDate(defaultJoiningDate)) {
        errors.push({
          row: rowNumber,
          field: "joining_date",
          message: "Invalid default joining date — use DD/MM/YYYY, e.g. 05/01/2026 for 5 January 2026",
          value: defaultJoiningDate,
        });
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
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const monthsElapsed = monthsBetween(parsedJoiningDate, today);
        if (monthsElapsed > 24) {
          issues.push(buildIssue("BACKFILL_CAPPED", rowNumber, { monthsElapsed, cappedTo: 24 }));
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
          joining_date: row.joining_date || defaultJoiningDate,
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
    return new Set([
      ...profiles.map((p: any) => p.phone!).filter(Boolean),
      ...invited.map((i: any) => i.phone).filter(Boolean),
    ]);
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
