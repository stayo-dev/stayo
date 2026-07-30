import * as XLSX from "xlsx";
import { prisma } from "../db";
import { getLogger } from "../logger";
import {
  hostelBillingPreferencesService,
  type MaintenanceType,
} from "./hostel-billing-preferences-service";

const logger = getLogger("bulk-import-validation");

export interface TenantImportRow {
  name: string;
  phone: string;
  email: string;
  room_no: string;
  room_id?: string;
  monthly_rent?: number;
  advance_deposit?: number;
  security_deposit?: number;
  deposit?: number;
  maintenance_charge?: number;
  maintenance_type?: MaintenanceType;
  joining_date?: string;
  notes?: string;
  billing_start_mode?: "JOINING_DATE" | "IMPORT_DATE";
  onboarding_password?: string;
  onboarding_password_hash?: string;
  profile_type?: string;
  emergency_contact?: string;
  gender?: string;
  rent_source?: "ROOM_CONFIG";
}

export interface ImportDefaults {
  joining_date?: string;
  advance_deposit?: number;
  security_deposit?: number;
  maintenance_charge?: number;
  maintenance_type?: MaintenanceType;
  billing_start_mode?: "JOINING_DATE" | "IMPORT_DATE";
}

export interface ValidationError {
  row: number;
  field: string;
  message: string;
  value?: any;
}

export interface ValidatedRow {
  row: number;
  data: TenantImportRow;
  errors: ValidationError[];
  warnings: string[];
  isDuplicate: boolean;
  duplicateReason?: string;
}

export interface ValidationResult {
  totalRows: number;
  validRows: ValidatedRow[];
  invalidRows: ValidatedRow[];
  duplicates: ValidatedRow[];
  summary: {
    valid: number;
    invalid: number;
    duplicates: number;
    warnings: number;
  };
}

const MAX_IMPORT_ROWS = 150;

export class BulkImportValidationService {
  async parseFile(fileBuffer: Buffer, filename: string): Promise<TenantImportRow[]> {
    try {
      const workbook = XLSX.read(fileBuffer, { type: "buffer", raw: true });
      const sheetName = workbook.SheetNames[0];
      
      if (!sheetName) {
        throw new Error("VALIDATION_ERROR: Excel file is empty or has no sheets");
      }

      const worksheet = workbook.Sheets[sheetName];
      const rawData: any[] = XLSX.utils.sheet_to_json(worksheet);

      if (rawData.length > MAX_IMPORT_ROWS) {
        throw new Error(`Import file too large. Maximum ${MAX_IMPORT_ROWS} rows allowed. Your file has ${rawData.length} rows. Please split into multiple files.`);
      }

      const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, {
        raw: true,
        defval: "",
      });

      if (!jsonData || jsonData.length === 0) {
        throw new Error("VALIDATION_ERROR: No data rows found in the file");
      }

      return this.normalizeRows(jsonData);
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

  private normalizeRows(rawData: any[]): TenantImportRow[] {
    return rawData.map((row) => ({
      name: this.readCell(row, ["Full Name", "full_name", "name", "Name", "NAME"]),
      phone: this.readCell(row, ["Phone Number", "phone_number", "phone", "Phone", "PHONE", "mobile", "Mobile"]),
      email: this.readCell(row, ["Username", "Email Address", "Email Address_1", "email_address", "email", "Email", "EMAIL"]),
      room_no: this.readCell(row, ["Current Room", "current_room", "room_no", "room", "Room", "ROOM", "room_number"]),
      monthly_rent: this.parseNumber(this.readCell(row, ["Monthly Rent", "monthly_rent", "rent", "Rent"])),
      advance_deposit: this.parseNumber(this.readCell(row, ["Deposit", "deposit", "Advance Deposit", "advance_deposit", "Security Deposit", "security_deposit"])),
      security_deposit: this.parseNumber(this.readCell(row, ["Deposit", "deposit", "Advance Deposit", "advance_deposit", "Security Deposit", "security_deposit"])),
      joining_date: this.readCell(row, ["Joining Date", "joining_date", "Join Date", "join_date"]) || undefined,
      notes: this.readCell(row, ["Notes", "notes"]) || undefined,
      profile_type: this.readCell(row, ["profile_type", "type"]) || "STUDENT",
      emergency_contact: this.readCell(row, ["emergency_contact", "emergency"]) || undefined,
      gender: this.readCell(row, ["gender", "Gender"]) || undefined,
    }));
  }

  private readCell(row: Record<string, any>, keys: string[]): string {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
        return String(row[key]).trim();
      }
    }
    return "";
  }

  private parseNumber(value: any): number | undefined {
    if (value === null || value === undefined || value === "") return undefined;
    const num = Number(String(value).replace(/[^0-9.-]/g, ""));
    return isNaN(num) ? undefined : num;
  }

  private normalizeMaintenanceType(value: any): "MONTHLY" | "ONE_TIME" | "NONE" | undefined {
    if (!value) return undefined;
    const normalized = String(value).toUpperCase().trim();
    if (["MONTHLY", "ONE_TIME", "NONE"].includes(normalized)) {
      return normalized as "MONTHLY" | "ONE_TIME" | "NONE";
    }
    return undefined;
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
    const billingDefaults = await hostelBillingPreferencesService.getBillingDefaults(hostelId);
    const phonesSeen = new Set<string>();
    const emailsSeen = new Set<string>();
    const roomAssignmentsSeen = new Map<string, number>();
    const defaultJoiningDate = importDefaults.joining_date || this.formatDate(new Date());
    const defaultMaintenanceType = importDefaults.maintenance_type || billingDefaults.maintenance_type;
    const defaultMaintenanceCharge = defaultMaintenanceType === "NONE"
      ? 0
      : (importDefaults.maintenance_charge ?? billingDefaults.maintenance_charge);
    const defaultAdvanceDeposit = importDefaults.security_deposit ?? importDefaults.advance_deposit ?? billingDefaults.security_deposit ?? billingDefaults.advance_deposit;
    const defaultBillingStartMode = importDefaults.billing_start_mode || "JOINING_DATE";

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;
      const errors: ValidationError[] = [];
      const warnings: string[] = [];
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

      const normalizedPhone = this.normalizePhone(row.phone);
      if (!normalizedPhone) {
        errors.push({
          row: rowNumber,
          field: "phone",
          message: "Valid phone number is required (10 digits)",
          value: row.phone,
        });
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
      } else if (!this.isValidEmail(normalizedEmail)) {
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
        if (this.isSpreadsheetFormula(value)) {
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
        const room = hostelRooms.find((r) => r.room_no === row.room_no);
        roomForRow = room;
        if (!room) {
          errors.push({
            row: rowNumber,
            field: "room_no",
            message: `Room ${row.room_no} not found in hostel`,
            value: row.room_no,
          });
        } else if (!room.is_active) {
          warnings.push(`Room ${row.room_no} is inactive`);
        } else {
          if (!room.base_rent || room.base_rent <= 0) {
            errors.push({
              row: rowNumber,
              field: "room_no",
              message: `Room ${row.room_no} does not have rent configured`,
              value: row.room_no,
            });
          }

          const currentOccupancy = room.occupied_count + room.reserved_count;
          const assignmentsInFile = roomAssignmentsSeen.get(room.id) || 0;
          if (currentOccupancy + assignmentsInFile + 1 > room.capacity) {
            errors.push({
              row: rowNumber,
              field: "room_no",
              message: `Room ${row.room_no} capacity would be exceeded (${currentOccupancy + assignmentsInFile + 1}/${room.capacity})`,
              value: row.room_no,
            });
          } else {
            roomAssignmentsSeen.set(room.id, assignmentsInFile + 1);
          }
        }
      }

      if (!this.parseDate(defaultJoiningDate)) {
        errors.push({
          row: rowNumber,
          field: "joining_date",
          message: "Invalid owner default joining date (use YYYY-MM-DD or DD/MM/YYYY)",
          value: defaultJoiningDate,
        });
      }

      const rowJoiningDate = row.joining_date || defaultJoiningDate;
      const parsedJoiningDate = this.parseDate(rowJoiningDate);
      if (row.joining_date && !parsedJoiningDate) {
        errors.push({
          row: rowNumber,
          field: "joining_date",
          message: "Invalid joining date (use YYYY-MM-DD or DD/MM/YYYY)",
          value: row.joining_date,
        });
      } else if (parsedJoiningDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (parsedJoiningDate < today) {
          warnings.push("Historical joining date requires owner confirmation before invitations are sent");
        }
      }

      const room = row.room_no ? hostelRooms.find((r) => r.room_no === row.room_no) : undefined;

      validatedRows.push({
        row: rowNumber,
        data: {
          ...row,
          phone: normalizedPhone || row.phone,
          email: normalizedEmail,
          room_id: roomForRow?.id || room?.id,
          monthly_rent: row.monthly_rent ?? (room?.base_rent ? Number(room.base_rent) : undefined),
          advance_deposit: row.security_deposit ?? row.advance_deposit ?? defaultAdvanceDeposit,
          security_deposit: row.security_deposit ?? row.advance_deposit ?? defaultAdvanceDeposit,
          maintenance_charge: defaultMaintenanceCharge,
          maintenance_type: defaultMaintenanceType,
          joining_date: row.joining_date || defaultJoiningDate,
          billing_start_mode: defaultBillingStartMode,
          rent_source: "ROOM_CONFIG",
        },
        errors,
        warnings,
        isDuplicate,
        duplicateReason,
      });
    }

    const validRows = validatedRows.filter((r) => r.errors.length === 0 && !r.isDuplicate);
    const invalidRows = validatedRows.filter((r) => r.errors.length > 0);
    const duplicates = validatedRows.filter((r) => r.isDuplicate);

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
      },
    };
  }

  private normalizePhone(phone: string): string | null {
    if (!phone) return null;
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length === 10) {
      return `+91${cleaned}`;
    }
    if (cleaned.length === 12 && cleaned.startsWith("91")) {
      return `+${cleaned}`;
    }
    if (cleaned.length === 13 && cleaned.startsWith("091")) {
      return `+${cleaned.substring(1)}`;
    }
    return null;
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private isValidPassword(password: string): boolean {
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    return hasLetter && hasNumber;
  }

  private isSpreadsheetFormula(value: unknown): boolean {
    const text = String(value || "").trim();
    return /^[=+\-@]/.test(text);
  }

  private parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;

    const trimmed = String(dateStr).trim();

    // Check if it's an Excel numeric date serial
    const numericDate = Number(trimmed);
    if (!isNaN(numericDate) && numericDate > 20000 && numericDate < 100000) {
      // Excel epoch is Dec 30, 1899
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const date = new Date(excelEpoch.getTime() + numericDate * 86400000);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    const formats = [
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
      /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/,
      /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/,
    ];

    for (const format of formats) {
      const match = trimmed.match(format);
      if (match) {
        let year, month, day;
        if (format === formats[0]) {
          [, year, month, day] = match;
        } else {
          [, day, month, year] = match;
        }

        if (year.length === 2) {
          year = "20" + year; // Convert "26" to "2026"
        }

        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }

    // Fallback using standard JS parsing if it looks like a date string
    const fallbackDate = new Date(trimmed);
    if (!isNaN(fallbackDate.getTime())) {
      return fallbackDate;
    }

    return null;
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
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
