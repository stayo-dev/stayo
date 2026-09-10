export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { bulkImportValidationService } from "@/lib/services/bulk-import-validation-service";
import { prisma } from "@/lib/db";
import crypto from "crypto";
import { sanitizeImportRowForStorage } from "@/lib/services/bulk-import/sanitize-row";

/**
 * 🔄 Bulk Import - Revalidate Editable Grid
 * POST /api/bulk-import/revalidate
 * Access: Owner/Admin only
 * 
 * Accepts modified JSON array of rows, re-validates, and issues a new batch ID.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Only owners/admins can import tenants", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { rows, hostel_id, filename, import_defaults, batch_id } = body;

    if (!rows || !Array.isArray(rows)) {
      return apiError("Rows array is required", "VALIDATION_ERROR", 400);
    }
    if (!hostel_id) {
      return apiError("Hostel ID is required", "VALIDATION_ERROR", 400);
    }

    const hostel = await prisma.hostels.findFirst({
      where: {
        id: hostel_id,
        owner_id: session.sub,
        status: "ACTIVE",
      },
    });

    if (!hostel) {
      return apiError("Hostel not found or access denied", "NOT_FOUND", 404);
    }

    const validation = await bulkImportValidationService.validateRows(
      rows,
      hostel_id,
      session.sub,
      import_defaults || {}
    );

    // Editing rows used to create a *new* batch every time, orphaning the
    // previous one with a full copy of every tenant's name, phone and email in
    // `validation_errors`. A dozen edits left a dozen copies. When the client
    // sends the batch it is editing, that batch is updated in place instead.
    const existing = batch_id
      ? await prisma.bulk_import_batches.findFirst({
          // VALIDATED only. An executed batch's rows are its record of what
          // was already created — deleting them would lose the idempotency
          // that stops a re-POST inviting the same tenants twice.
          where: {
            id: String(batch_id),
            owner_id: session.sub,
            hostel_id,
            status: "VALIDATED",
          },
          select: { id: true, validation_errors: true },
        })
      : null;
    if (batch_id && !existing) {
      return apiError(
        "That import can't be edited any more — it has already started creating tenants. Upload the file again to start a new one.",
        "NOT_FOUND",
        404
      );
    }
    // The Rooms plan belongs to the uploaded workbook, which we no longer
    // hold, so it must survive an edit to a tenant row.
    const previousRoomPlan = (existing?.validation_errors as any)?.room_plan;
    const batchId = existing?.id ?? crypto.randomUUID();
    const validRowsForImport = validation.validRows.map((r) => ({
      row: r.row,
      data: sanitizeImportRowForStorage(r.data),
      warnings: r.warnings,
    }));
    const hasHistoricalJoinDateWarnings = validation.validRows.some((r) =>
      r.warnings.some((warning) => warning.toLowerCase().includes("historical joining date"))
    );

    await prisma.$transaction(async (tx: any) => {
      const batchFields = {
        owner_id: session.sub,
        hostel_id: hostel_id,
        filename: filename || "edited-batch.csv",
        file_size: JSON.stringify(rows).length,
        total_rows: validation.totalRows,
        valid_rows: validation.summary.valid,
        failed_rows: validation.summary.invalid,
        duplicate_rows: validation.summary.duplicates,
        status: "VALIDATED",
        validation_errors: {
          defaults: import_defaults || {},
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
          // The Rooms plan belongs to the uploaded workbook, which we no
          // longer hold. Editing a tenant row must not discard it.
          ...(previousRoomPlan ? { room_plan: previousRoomPlan } : {}),
        } as any,
        import_source_version: "tenant_invitation_lifecycle_v1",
        uploaded_by: session.sub,
      };

      if (existing) {
        await tx.bulk_import_batches.update({ where: { id: batchId }, data: batchFields });
        // The edited rows replace the previous set outright; leaving the old
        // ones would execute rows the owner has since corrected.
        await tx.bulk_import_rows.deleteMany({ where: { batch_id: batchId } });
      } else {
        await tx.bulk_import_batches.create({ data: { id: batchId, ...batchFields } });
      }

      for (const row of validation.validRows) {
        await tx.bulk_import_rows.create({
          data: {
            id: crypto.randomUUID(),
            batch_id: batchId,
            owner_id: session.sub,
            hostel_id: hostel_id,
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
        filename: filename || "edited-batch.csv",
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
    const rawMessage = String(error?.message || "Failed to revalidate rows");
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
    return apiError(normalizedMessage, normalizedCode || "REVALIDATE_ERROR", status);
  }
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

