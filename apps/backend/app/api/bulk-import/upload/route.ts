export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { bulkImportValidationService } from "@/lib/services/bulk-import-validation-service";
import { isAcceptedImportFile } from "@/lib/services/bulk-import/file-type";
import { readHostelStamp } from "@/lib/services/bulk-import/hostel-stamp";
import { parseRoomsSheet } from "@/lib/services/bulk-import/rooms-sheet";
import { buildRoomPlan } from "@/lib/services/bulk-import/room-plan";
import { sanitizeImportRowForStorage } from "@/lib/services/bulk-import/sanitize-row";
import { needsHistoricalJoinDateConfirmation } from "@/lib/services/bulk-import/issues";
import { prisma } from "@/lib/db";
import crypto from "crypto";
import type { ImportDefaults } from "@/lib/services/bulk-import-validation-service";

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

    if (!isAcceptedImportFile(file.name, file.type)) {
      return apiError(
        "That file type can't be imported. Upload the Excel workbook you downloaded (.xlsx), or a .csv.",
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

    // Every hostel has a room 101, so importing the wrong hostel's workbook
    // would place tenants in the wrong rooms and report nothing wrong. A file
    // the owner made themselves carries no stamp and is still accepted.
    const stamp = readHostelStamp(fileBuffer);
    if (stamp && stamp !== hostelId) {
      const stamped = await prisma.hostels.findFirst({
        where: { id: stamp, owner_id: session.sub },
        select: { name: true },
      });
      return apiError(
        `This file was made for ${stamped?.name ?? "a different hostel"}. Room numbers repeat across hostels, so importing it here could put tenants in the wrong rooms. Switch to that hostel, or download a fresh template for ${hostel.name}.`,
        "VALIDATION_ERROR",
        400
      );
    }

    const importDefaults = parseImportDefaults(formData);

    // The Rooms sheet, if the workbook has one. Planned here so the owner sees
    // what will be created before confirming, and so confirm executes the plan
    // they saw rather than re-deriving it from a file we no longer hold.
    const roomPlan = await planRoomsFromWorkbook(fileBuffer, hostelId);

    const rows = await bulkImportValidationService.parseFile(
      fileBuffer,
      file.name
    );

    const validation = await bulkImportValidationService.validateRows(
      rows,
      hostelId,
      session.sub,
      importDefaults,
      // Rooms this same workbook adds. A tenant may live in one of them: the
      // template tells the owner to add a missing room on the Rooms sheet and
      // then pick it, so they must validate.
      roomPlan.create.map((room) => ({
        room_no: room.room_no,
        capacity: room.capacity,
        base_rent: room.base_rent,
      }))
    );

    const batchId = crypto.randomUUID();
    const validRowsForImport = validation.validRows.map((r) => ({
      row: r.row,
      data: sanitizeImportRowForStorage(r.data),
      warnings: r.warnings,
      // Persisted, not just returned: the review screen renders issues, and
      // without these a reload showed every row as clean.
      issues: r.issues,
    }));
    // Read off the issues, not a warning string: the gate at confirm and the
    // control on the review screen must come from the same fact, or the
    // owner is refused a confirmation they have no way to give.
    const hasHistoricalJoinDateWarnings = validation.validRows.some((r) =>
      needsHistoricalJoinDateConfirmation(r.issues ?? [])
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
              issues: r.issues,
            })),
            duplicates: validation.duplicates.map((r) => ({
              row: r.row,
              data: sanitizeImportRowForStorage(r.data),
              reason: r.duplicateReason,
              warnings: r.warnings,
              issues: r.issues,
            })),
            requires_historical_join_date_confirmation: hasHistoricalJoinDateWarnings,
            summary: {
              blockers: validation.summary.blockers,
              choices: validation.summary.choices,
              warnings: validation.summary.warnings,
            },
            room_plan: {
              create: roomPlan.create,
              update: roomPlan.update,
              unchanged: roomPlan.unchanged,
              issues: roomPlan.issues,
            },
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
          blockers: validation.summary.blockers,
          choices: validation.summary.choices,
          requires_historical_join_date_confirmation: hasHistoricalJoinDateWarnings,
        },
        rooms: {
          to_create: roomPlan.create.length,
          to_update: roomPlan.update.length,
          unchanged: roomPlan.unchanged.length,
          issues: roomPlan.issues,
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

/**
 * What the workbook's Rooms sheet means for this hostel.
 *
 * Returns an empty plan for a file with no Rooms sheet — an owner's own
 * spreadsheet — so the tenant import still works exactly as before.
 */
async function planRoomsFromWorkbook(fileBuffer: Buffer, hostelId: string) {
  const sheet = parseRoomsSheet(fileBuffer);
  if (!sheet.length) return { create: [], update: [], unchanged: [], issues: [] };

  const rooms = await prisma.rooms.findMany({
    where: { hostel_id: hostelId },
    select: {
      id: true,
      room_no: true,
      capacity: true,
      base_rent: true,
      room_type: true,
      is_active: true,
      floor: true,
      _count: {
        select: {
          room_allocations: { where: { is_active: true, end_date: null, tenant: { status: "ACTIVE" } } },
          tenant_invitation_reservations: { where: { status: "ACTIVE", expires_at: { gt: new Date() } } },
        },
      },
    },
  });

  return buildRoomPlan(
    sheet,
    rooms.map((room: any) => ({
      id: room.id,
      room_no: room.room_no,
      capacity: room.capacity,
      base_rent: room.base_rent,
      room_type: room.room_type,
      is_active: room.is_active,
      floor: room.floor,
      occupied_count: room._count?.room_allocations ?? 0,
      reserved_count: room._count?.tenant_invitation_reservations ?? 0,
    }))
  );
}
