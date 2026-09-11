export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import type { TenantImportRow } from "@/lib/services/bulk-import-validation-service";
import { tenantInvitationLifecycleService } from "@/src/services/tenants/tenant-invitation-lifecycle-service";
import { applyRoomPlan } from "@/src/services/bulk-import/room-import-service";
import type { RoomPlan } from "@/lib/services/bulk-import/room-plan";

/**
 * Bulk import batch preview.
 */
const logger = getLogger("bulk-import-confirm");

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
          warnings: validationPayload.summary?.warnings
            ?? validationPayload.valid_rows.reduce((sum, row: any) => sum + (row.warnings?.length || 0), 0),
          // Served so the review screen can say "2 need you" without walking
          // every row itself — and so it works on a reload.
          blockers: validationPayload.summary?.blockers ?? 0,
          choices: validationPayload.summary?.choices ?? 0,
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

    const chunkSize = Math.min(
      Math.max(Math.trunc(Number(body?.chunk_size)) || DEFAULT_CHUNK_SIZE, 1),
      MAX_CHUNK_SIZE
    );

    // Rooms first, and only once: the tenants reference them. Recorded on the
    // batch so a re-POST after a dropped connection does not create them
    // twice. A room failure is reported but never aborts the tenant import —
    // the rows that can land should land.
    const roomPlan = getValidationPayload(batch.validation_errors).room_plan;
    let rooms = (batch.import_summary as any)?.rooms ?? { created: 0, updated: 0, errors: [] };
    if (roomPlan && !(batch.import_summary as any)?.rooms) {
      const applied = await applyRoomPlan(roomPlan as RoomPlan, session.sub, batch.hostel_id);
      rooms = applied;
      await prisma.bulk_import_batches.update({
        where: { id: batchId },
        data: { import_summary: { ...((batch.import_summary as any) ?? {}), rooms: applied } },
      });
    }

    const result = await executeInvitationBatch(session.sub, batchId, chunkSize);

    return apiResponse(
      {
        batch_id: batchId,
        hostel: {
          id: batch.hostel.id,
          name: batch.hostel.name,
        },
        progress: result.progress,
        rooms,
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
  valid_rows: Array<{ row: number; data: TenantImportRow; warnings?: string[]; issues?: any[] }>;
  summary?: { blockers?: number; choices?: number; warnings?: number };
  room_plan?: RoomPlan;
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
    room_plan: payload.room_plan,
    summary: payload.summary,
    invalid: Array.isArray(payload.invalid) ? payload.invalid : [],
    duplicates: Array.isArray(payload.duplicates) ? payload.duplicates : [],
    requires_historical_join_date_confirmation: Boolean(payload.requires_historical_join_date_confirmation),
  };
}

/**
 * How many tenants one confirm request creates.
 *
 * Each row is a transaction plus a notification dispatch, so a whole batch in
 * one request could not finish inside the function's time limit. The client
 * re-POSTs while `remaining > 0`; rows already SUCCESS are skipped, so a
 * dropped connection loses nothing — every bit of state is in
 * `bulk_import_rows`.
 */
const DEFAULT_CHUNK_SIZE = 25;
const MAX_CHUNK_SIZE = 25;

async function executeInvitationBatch(
  ownerId: string,
  batchId: string,
  chunkSize: number
) {
  let successCount = 0;
  let failureCount = 0;
  let emailFailureCount = 0;
  const results: any[] = [];
  const errors: any[] = [];

  const batchBefore = await prisma.bulk_import_batches.update({
    where: { id: batchId },
    data: { status: "PROCESSING" },
    select: { import_summary: true },
  });
  const priorSummary = batchBefore?.import_summary;

  // `bulk_import_rows` is the authority on what to execute — one row, one
  // primary key. The batch's `validation_errors` JSON is a preview artefact,
  // and matching on email+phone would update two rows that happened to share
  // both.
  const [total, , rows] = await Promise.all([
    prisma.bulk_import_rows.count({ where: { batch_id: batchId } }),
    prisma.bulk_import_rows.count({ where: { batch_id: batchId, execution_status: "SUCCESS" } }),
    // Only PENDING rows. A FAILED row has already been attempted and counts
    // as processed — re-selecting it here would refill every later chunk with
    // the same failures (they sort first by row number), so a batch with more
    // failures than a chunk holds would never advance and the client's
    // `remaining > 0` loop would never end. Retrying a failure is a separate,
    // deliberate action.
    prisma.bulk_import_rows.findMany({
      where: { batch_id: batchId, execution_status: "PENDING" },
      orderBy: { row_number: "asc" },
      take: chunkSize,
    }),
  ]);

  // Rows already attempted are excluded by the query above — that is what
  // makes a re-POST safe after a dropped connection.
  for (const row of rows) {
    const data = row.mapped_data as TenantImportRow;

    try {
      const invitationResult: any = await tenantInvitationLifecycleService.createInvitation({
        name: data.name,
        email: data.email,
        phone: data.phone,
        room_id: data.room_id,
        monthly_rent: data.monthly_rent,
        advance_deposit: data.advance_deposit,
        // createInvitation reads `maintenance_amount`, not
        // `maintenance_charge` — only its edit path accepts both. Sending
        // the wrong key here silently fell back to the hostel default,
        // which was the exact class of drop this plan exists to fix.
        maintenance_amount: data.maintenance_charge,
        maintenance_type: data.maintenance_type,
        agreement_duration_months: data.agreement_duration_months,
        paid_amount: data.amount_paid,
        // "No" keeps the deposit owed: createInvitation filters the
        // settlement to non-deposit obligations.
        paid_includes_deposit: data.amount_includes_deposit,
        payment_method: data.payment_method,
        payment_reference: data.payment_reference,
        joining_date: data.joining_date,
        notes: data.notes,
        batch_id: batchId,
        // Created, not sent. The owner sends in waves from the import's last
        // step, so an import of forty residents does not put forty messages
        // on forty phones at once — and each tenant's expiry clock starts
        // when their own invitation actually goes out.
        dispatch: "DEFERRED",
      }, ownerId);

      // The sheet's Notes column reached bulk_import_rows and stopped there:
      // createInvitation reads no notes key and `tenants` has no notes column.
      // A note the owner took the trouble to write belongs on the tenant, so
      // it becomes a tenant_notes row. Never fatal — the tenancy is already
      // created, and losing a note must not fail the import.
      const note = String(data.notes ?? "").trim();
      if (note && invitationResult.tenant_id) {
        try {
          await prisma.tenant_notes.create({
            data: {
              tenant_id: invitationResult.tenant_id,
              owner_id: ownerId,
              content: note,
            },
          });
        } catch (noteError: any) {
          logger.warn("bulk_import.note_not_saved", {
            batch_id: batchId,
            row: row.row_number,
            error: String(noteError?.message || noteError),
          });
        }
      }

      // A queued invitation was never sent, so it has not failed to send.
      // Counting it would report every imported row as an email failure.
      const queued = Boolean(invitationResult.queued);
      if (!queued && !invitationResult.email_sent) emailFailureCount++;
      successCount++;
      await prisma.bulk_import_rows.update({
        where: { id: row.id },
        data: {
          tenant_id: invitationResult.tenant_id,
          invitation_id: invitationResult.invitation_id,
          reservation_id: invitationResult.reservation_id,
          execution_status: "SUCCESS",
          email_status: queued ? "QUEUED" : invitationResult.email_sent ? "SENT" : "FAILED",
          error_message: invitationResult.email_error || null,
          executed_at: new Date(),
        },
      });
      results.push({
        row: row.row_number,
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
      await prisma.bulk_import_rows.update({
        where: { id: row.id },
        data: {
          execution_status: "FAILED",
          error_message: message,
          executed_at: new Date(),
        },
      });
      errors.push({ row: row.row_number, error: message });
      results.push({ row: row.row_number, success: false, error: message });
    }
  }

  // Totals across every chunk so far, not just this one.
  const [succeededTotal, failedTotal] = await Promise.all([
    prisma.bulk_import_rows.count({ where: { batch_id: batchId, execution_status: "SUCCESS" } }),
    prisma.bulk_import_rows.count({ where: { batch_id: batchId, execution_status: "FAILED" } }),
  ]);
  const processed = succeededTotal + failedTotal;
  const remaining = Math.max(total - processed, 0);
  const done = remaining === 0;

  // A terminal status only when nothing is left. Marking the batch COMPLETED
  // after the first chunk would tell the owner the import had finished while
  // most of their tenants were still unprocessed.
  await prisma.bulk_import_batches.update({
    where: { id: batchId },
    data: {
      status: !done
        ? "PROCESSING"
        : failedTotal === 0
          ? "COMPLETED"
          : succeededTotal > 0
            ? "PARTIAL"
            : "FAILED",
      imported_rows: succeededTotal,
      failed_rows: failedTotal,
      // Merged, not replaced: the rooms this batch created were recorded here
      // by the first chunk, and overwriting them would make every later chunk
      // create them again — which fails, because a floor would then be
      // submitted with the same room number twice.
      import_summary: {
        ...((priorSummary as any) ?? {}),
        total_requested: total,
        success_count: succeededTotal,
        failure_count: failedTotal,
        email_failure_count:
          Number((priorSummary as any)?.email_failure_count ?? 0) + emailFailureCount,
      },
      ...(done ? { imported_at: new Date() } : {}),
    },
  });

  return {
    totalRequested: total,
    successCount,
    failureCount,
    emailFailureCount,
    results,
    errors,
    progress: {
      total,
      processed,
      remaining,
      succeeded: succeededTotal,
      failed: failedTotal,
      stage: done ? ("DONE" as const) : ("TENANTS" as const),
    },
  };
}

function sanitizeImportRowForPreview(row: { row: number; data: TenantImportRow }) {
  return {
    row: row.row,
    // At the row, not inside `data`: the review screen reads `row.issues`, and
    // nesting them here made every valid row look clean on a reload — the
    // exact defect persisting them was meant to fix.
    issues: (row as any).issues ?? [],
    data: {
      name: row.data.name,
      phone: row.data.phone,
      email: row.data.email,
      room_no: row.data.room_no,
      monthly_rent: row.data.monthly_rent,
      advance_deposit: row.data.advance_deposit,
      maintenance_charge: row.data.maintenance_charge,
      maintenance_type: row.data.maintenance_type,
      agreement_duration_months: row.data.agreement_duration_months,
      amount_paid: row.data.amount_paid,
      payment_method: row.data.payment_method,
      joining_date: row.data.joining_date,
      rent_source: row.data.rent_source,
      warnings: (row as any).warnings || [],
    },
  };
}
