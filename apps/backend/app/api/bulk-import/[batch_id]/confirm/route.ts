export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { TenantImportRow } from "@/lib/services/bulk-import-validation-service";
import { tenantInvitationLifecycleService } from "@/src/services/tenants/tenant-invitation-lifecycle-service";

/**
 * Bulk import batch preview.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { batch_id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Only owners/admins can import tenants", "FORBIDDEN", 403);
  }

  try {
    const batchId = params.batch_id;

    const batch = await prisma.bulk_import_batches.findFirst({
      where: {
        id: batchId,
        owner_id: session.sub,
        status: { in: ["VALIDATED", "PROCESSING", "PARTIAL", "FAILED", "COMPLETED"] as any },
      },
      include: {
        hostel: true,
      },
    });

    if (!batch) {
      return apiError(
        "Batch not found",
        "NOT_FOUND",
        404
      );
    }

    const validationPayload = getValidationPayload(batch.validation_errors);

    return apiResponse(
      {
        batch_id: batch.id,
        filename: batch.filename,
        hostel: {
          id: batch.hostel.id,
          name: batch.hostel.name,
        },
        validation: {
          total_rows: batch.total_rows,
          valid_rows: batch.valid_rows,
          invalid_rows: batch.failed_rows,
          duplicate_rows: batch.duplicate_rows,
          warnings: validationPayload.valid_rows.reduce((sum, row: any) => sum + (row.warnings?.length || 0), 0),
          requires_historical_join_date_confirmation: Boolean(validationPayload.requires_historical_join_date_confirmation),
        },
        defaults: validationPayload.defaults || {},
        preview: {
          valid: validationPayload.valid_rows.map(sanitizeImportRowForPreview),
          invalid: validationPayload.invalid || [],
          duplicates: validationPayload.duplicates || [],
        },
      },
      200
    );
  } catch (error: any) {
    const rawMessage = String(error?.message || "Failed to load import batch");
    const [maybeCode, ...rest] = rawMessage.split(":");
    const normalizedCode = maybeCode?.trim();
    const normalizedMessage = rest.length > 0 ? rest.join(":").trim() : rawMessage;

    const statusMap: Record<string, number> = {
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      INTERNAL_ERROR: 500,
    };

    const status = statusMap[normalizedCode] || 500;
    return apiError(normalizedMessage, normalizedCode || "BATCH_ERROR", status);
  }
}

/**
 * 🚀 Bulk Import - Confirm and Execute
 * POST /api/bulk-import/[batch_id]/confirm
 * Access: Owner/Admin only
 * 
 * Executes the validated bulk import
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { batch_id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Only owners/admins can import tenants", "FORBIDDEN", 403);
  }

  try {
    const batchId = params.batch_id;
    const body = await req.json().catch(() => ({}));

    const batch = await prisma.bulk_import_batches.findFirst({
      where: {
        id: batchId,
        owner_id: session.sub,
        status: { in: ["VALIDATED", "PROCESSING", "PARTIAL", "FAILED", "COMPLETED"] as any },
      },
      include: {
        hostel: true,
      },
    });

    if (!batch) {
      return apiError(
        "Batch not found",
        "NOT_FOUND",
        404
      );
    }

    const validRowsWithData = getValidationPayload(batch.validation_errors).valid_rows;
    const validationPayload = getValidationPayload(batch.validation_errors);

    if (!validRowsWithData.length) {
      return apiError("No valid tenant rows are available for this batch", "VALIDATION_ERROR", 400);
    }

    if (validationPayload.requires_historical_join_date_confirmation && body?.confirm_historical_join_dates !== true) {
      return apiError(
        "This batch contains historical joining dates. Confirm historical join dates before sending invitations.",
        "VALIDATION_ERROR",
        400
      );
    }

    const result = await executeInvitationBatch(validRowsWithData, session.sub, batch.hostel_id, batchId);

    return apiResponse(
      {
        batch_id: batchId,
        hostel: {
          id: batch.hostel.id,
          name: batch.hostel.name,
        },
        result: {
          total_requested: result.totalRequested,
          success_count: result.successCount,
          failure_count: result.failureCount,
          email_failure_count: result.emailFailureCount,
          results: result.results,
          errors: result.errors.slice(0, 50),
        },
      },
      200
    );
  } catch (error: any) {
    const rawMessage = String(error?.message || "Failed to execute import");
    const [maybeCode, ...rest] = rawMessage.split(":");
    const normalizedCode = maybeCode?.trim();
    const normalizedMessage = rest.length > 0 ? rest.join(":").trim() : rawMessage;

    const statusMap: Record<string, number> = {
      VALIDATION_ERROR: 400,
      BAD_REQUEST: 400,
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      TENANT_LIMIT_EXCEEDED: 402,
      INTERNAL_ERROR: 500,
    };

    const status = statusMap[normalizedCode] || 500;
    return apiError(normalizedMessage, normalizedCode || "IMPORT_ERROR", status);
  }
}

function getValidationPayload(raw: unknown): {
  defaults?: Record<string, unknown>;
  valid_rows: Array<{ row: number; data: TenantImportRow; warnings?: string[] }>;
  invalid?: Array<Record<string, unknown>>;
  duplicates?: Array<Record<string, unknown>>;
  requires_historical_join_date_confirmation?: boolean;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid_rows: [] };
  }

  const payload = raw as Record<string, any>;
  return {
    defaults: payload.defaults,
    valid_rows: Array.isArray(payload.valid_rows) ? payload.valid_rows : [],
    invalid: Array.isArray(payload.invalid) ? payload.invalid : [],
    duplicates: Array.isArray(payload.duplicates) ? payload.duplicates : [],
    requires_historical_join_date_confirmation: Boolean(payload.requires_historical_join_date_confirmation),
  };
}

async function executeInvitationBatch(
  rows: Array<{ row: number; data: TenantImportRow; warnings?: string[] }>,
  ownerId: string,
  hostelId: string,
  batchId: string
) {
  let successCount = 0;
  let failureCount = 0;
  let emailFailureCount = 0;
  const results: any[] = [];
  const errors: any[] = [];

  await prisma.bulk_import_batches.update({
    where: { id: batchId },
    data: { status: "PROCESSING" },
  });

  for (const row of rows) {
    const existingRow = await prisma.bulk_import_rows.findFirst({
      where: {
        batch_id: batchId,
        normalized_email: row.data.email,
        normalized_phone: row.data.phone,
      },
    });
    if (existingRow?.execution_status === "SUCCESS") {
      successCount++;
      results.push({
        row: row.row,
        success: true,
        tenant_id: existingRow.tenant_id,
        invitation_id: existingRow.invitation_id,
        reservation_id: existingRow.reservation_id,
        action: "IDEMPOTENT_RETRY",
      });
      continue;
    }

    try {
      const invitationResult: any = await tenantInvitationLifecycleService.createInvitation({
        name: row.data.name,
        email: row.data.email,
        phone: row.data.phone,
        room_id: row.data.room_id,
        monthly_rent: row.data.monthly_rent,
        advance_deposit: row.data.advance_deposit,
        joining_date: row.data.joining_date,
        notes: row.data.notes,
        batch_id: batchId,
      }, ownerId);

      if (!invitationResult.email_sent) emailFailureCount++;
      successCount++;
      await prisma.bulk_import_rows.updateMany({
        where: {
          batch_id: batchId,
          normalized_email: row.data.email,
          normalized_phone: row.data.phone,
        },
        data: {
          tenant_id: invitationResult.tenant_id,
          invitation_id: invitationResult.invitation_id,
          reservation_id: invitationResult.reservation_id,
          execution_status: "SUCCESS",
          email_status: invitationResult.email_sent ? "SENT" : "FAILED",
          error_message: invitationResult.email_error || null,
          executed_at: new Date(),
        },
      });
      results.push({
        row: row.row,
        success: true,
        tenant_id: invitationResult.tenant_id,
        invitation_id: invitationResult.invitation_id,
        reservation_id: invitationResult.reservation_id,
        email_sent: invitationResult.email_sent,
        email_error: invitationResult.email_error,
      });
    } catch (error: any) {
      failureCount++;
      const message = String(error?.message || "Invitation failed");
      await prisma.bulk_import_rows.updateMany({
        where: {
          batch_id: batchId,
          normalized_email: row.data.email,
          normalized_phone: row.data.phone,
        },
        data: {
          execution_status: "FAILED",
          error_message: message,
          executed_at: new Date(),
        },
      });
      errors.push({ row: row.row, error: message });
      results.push({ row: row.row, success: false, error: message });
    }
  }

  await prisma.bulk_import_batches.update({
    where: { id: batchId },
    data: {
      status: failureCount === 0 ? "COMPLETED" : successCount > 0 ? "PARTIAL" : "FAILED",
      imported_rows: successCount,
      failed_rows: failureCount,
      import_summary: {
        total_requested: rows.length,
        success_count: successCount,
        failure_count: failureCount,
        email_failure_count: emailFailureCount,
      },
      imported_at: new Date(),
    },
  });

  return {
    totalRequested: rows.length,
    successCount,
    failureCount,
    emailFailureCount,
    results,
    errors,
  };
}

function sanitizeImportRowForPreview(row: { row: number; data: TenantImportRow }) {
  return {
    row: row.row,
    data: {
      name: row.data.name,
      phone: row.data.phone,
      email: row.data.email,
      room_no: row.data.room_no,
      monthly_rent: row.data.monthly_rent,
      advance_deposit: row.data.advance_deposit,
      maintenance_charge: row.data.maintenance_charge,
      maintenance_type: row.data.maintenance_type,
      joining_date: row.data.joining_date,
      billing_start_mode: row.data.billing_start_mode,
      rent_source: row.data.rent_source,
      warnings: (row as any).warnings || [],
    },
  };
}
