export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { bulkImportValidationService } from "@/lib/services/bulk-import-validation-service";
import { prisma } from "@/lib/db";
import crypto from "crypto";
import type { ImportDefaults, TenantImportRow } from "@/lib/services/bulk-import-validation-service";

/**
 * 📤 Bulk Import - Upload and Validate
 * POST /api/bulk-import/upload
 * Access: Owner/Admin only
 * 
 * Accepts XLSX/CSV file, validates data, returns preview
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Only owners/admins can import tenants", "FORBIDDEN", 403);
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const hostelId = formData.get("hostel_id") as string;

    if (!file) {
      return apiError("File is required", "VALIDATION_ERROR", 400);
    }

    if (!hostelId) {
      return apiError("Hostel ID is required", "VALIDATION_ERROR", 400);
    }

    const hostel = await prisma.hostels.findFirst({
      where: {
        id: hostelId,
        owner_id: session.sub,
        status: "ACTIVE",
      },
    });

    if (!hostel) {
      return apiError("Hostel not found or access denied", "NOT_FOUND", 404);
    }

    const allowedTypes = [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
    ];

    if (!allowedTypes.includes(file.type)) {
      return apiError(
        "Invalid file type. Please upload Excel (.xlsx, .xls) or CSV file",
        "VALIDATION_ERROR",
        400
      );
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return apiError(
        "File too large. Maximum size is 5MB",
        "VALIDATION_ERROR",
        400
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const importDefaults = parseImportDefaults(formData);

    const rows = await bulkImportValidationService.parseFile(
      fileBuffer,
      file.name
    );

    const validation = await bulkImportValidationService.validateRows(
      rows,
      hostelId,
      session.sub,
      importDefaults
    );

    const batchId = crypto.randomUUID();
    const validRowsForImport = validation.validRows.map((r) => ({
      row: r.row,
      data: sanitizeImportRowForStorage(r.data),
      warnings: r.warnings,
    }));
    const hasHistoricalJoinDateWarnings = validation.validRows.some((r) =>
      r.warnings.some((warning) => warning.toLowerCase().includes("historical joining date"))
    );

    await prisma.$transaction(async (tx: any) => {
      await tx.bulk_import_batches.create({
        data: {
          id: batchId,
          owner_id: session.sub,
          hostel_id: hostelId,
          filename: file.name,
          file_size: file.size,
          total_rows: validation.totalRows,
          valid_rows: validation.summary.valid,
          failed_rows: validation.summary.invalid,
          duplicate_rows: validation.summary.duplicates,
          status: "VALIDATED",
          validation_errors: {
            defaults: importDefaults,
            valid_rows: validRowsForImport,
            invalid: validation.invalidRows.map((r) => ({
              row: r.row,
              data: sanitizeImportRowForStorage(r.data),
              errors: r.errors,
              warnings: r.warnings,
            })),
            duplicates: validation.duplicates.map((r) => ({
              row: r.row,
              data: sanitizeImportRowForStorage(r.data),
              reason: r.duplicateReason,
              warnings: r.warnings,
            })),
            requires_historical_join_date_confirmation: hasHistoricalJoinDateWarnings,
          } as any,
          import_source_version: "tenant_invitation_lifecycle_v1",
          uploaded_by: session.sub,
        },
      });

      for (const row of validation.validRows) {
        await tx.bulk_import_rows.create({
          data: {
            id: crypto.randomUUID(),
            batch_id: batchId,
            owner_id: session.sub,
            hostel_id: hostelId,
            row_number: row.row,
            normalized_email: row.data.email,
            normalized_phone: row.data.phone,
            normalized_room: row.data.room_no,
            mapped_data: sanitizeImportRowForStorage(row.data),
            validation_status: row.warnings.length ? "READY_WITH_WARNINGS" : "READY",
            execution_status: "PENDING",
          },
        });
      }
    });

    return apiResponse(
      {
        batch_id: batchId,
        filename: file.name,
        validation: {
          total_rows: validation.totalRows,
          valid_rows: validation.summary.valid,
          invalid_rows: validation.summary.invalid,
          duplicate_rows: validation.summary.duplicates,
          warnings: validation.summary.warnings,
          requires_historical_join_date_confirmation: hasHistoricalJoinDateWarnings,
        },
        preview: {
          valid: validation.validRows.map(sanitizeValidatedRow),
          invalid: validation.invalidRows.map(sanitizeValidatedRow),
          duplicates: validation.duplicates.map(sanitizeValidatedRow),
        },
      },
      200
    );
  } catch (error: any) {
    const rawMessage = String(error?.message || "Failed to process file");
    const [maybeCode, ...rest] = rawMessage.split(":");
    const normalizedCode = maybeCode?.trim();
    const normalizedMessage = rest.length > 0 ? rest.join(":").trim() : rawMessage;

    const statusMap: Record<string, number> = {
      VALIDATION_ERROR: 400,
      BAD_REQUEST: 400,
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      INTERNAL_ERROR: 500,
    };

    const status = statusMap[normalizedCode] || 500;
    return apiError(normalizedMessage, normalizedCode || "UPLOAD_ERROR", status);
  }
}

function parseImportDefaults(formData: FormData): ImportDefaults {
  const maintenanceType = String(formData.get("maintenance_type") || "").toUpperCase();
  return {
    joining_date: stringValue(formData.get("joining_date")),
    advance_deposit: numberValue(formData.get("advance_deposit")),
    maintenance_charge: numberValue(formData.get("maintenance_charge")),
    maintenance_type: ["MONTHLY", "ONE_TIME", "NONE"].includes(maintenanceType)
      ? maintenanceType as ImportDefaults["maintenance_type"]
      : undefined,
    billing_start_mode: formData.get("billing_start_mode") === "IMPORT_DATE"
      ? "IMPORT_DATE"
      : "JOINING_DATE",
  };
}

function stringValue(value: FormDataEntryValue | null) {
  const text = String(value || "").trim();
  return text || undefined;
}

function numberValue(value: FormDataEntryValue | null) {
  const text = String(value || "").trim();
  if (!text) return undefined;
  const num = Number(text);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error("VALIDATION_ERROR: Import default amounts must be zero or greater");
  }
  return num;
}

function sanitizeValidatedRow(row: any) {
  return {
    ...row,
    data: {
      ...row.data,
      onboarding_password_hash: undefined,
    },
  };
}

function sanitizeImportRowForStorage(row: TenantImportRow): Partial<TenantImportRow> {
  return {
    name: row.name,
    phone: row.phone,
    email: row.email,
    room_no: row.room_no,
    room_id: row.room_id,
    monthly_rent: row.monthly_rent,
    advance_deposit: row.advance_deposit,
    joining_date: row.joining_date,
    notes: row.notes,
  };
}
