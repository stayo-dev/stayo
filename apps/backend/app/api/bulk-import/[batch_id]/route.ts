export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: { batch_id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Only owners/admins can view import batches", "FORBIDDEN", 403);
  }

  try {
    const batch = await prisma.bulk_import_batches.findFirst({
      where: {
        id: params.batch_id,
        owner_id: session.sub,
      },
      include: {
        hostels: {
          select: {
            id: true,
            name: true,
          },
        },
        bulk_import_rows: {
          orderBy: { row_number: "asc" },
          include: {
            invitation: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                status: true,
                opened_at: true,
                activation_started_at: true,
                activated_at: true,
                expires_at: true,
              },
            },
            reservation: {
              select: {
                id: true,
                status: true,
                release_reason: true,
                released_at: true,
              },
            },
          },
        },
        tenant_invitations: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!batch) {
      return apiError("Batch not found", "NOT_FOUND", 404);
    }

    const funnel = buildFunnel(batch.tenant_invitations || []);
    const rows = batch.bulk_import_rows.map((row: any) => ({
      id: row.id,
      row_number: row.row_number,
      name: row.invitation?.name || row.mapped_data?.name || null,
      email: row.invitation?.email || row.normalized_email,
      phone: row.invitation?.phone || row.normalized_phone,
      room: row.normalized_room,
      validation_status: row.validation_status,
      execution_status: row.execution_status,
      email_status: row.email_status,
      error_message: row.error_message,
      invitation_id: row.invitation_id,
      tenant_id: row.tenant_id,
      reservation_id: row.reservation_id,
      invitation_status: row.invitation?.status || null,
      reservation_status: row.reservation?.status || null,
      reservation_release_reason: row.reservation?.release_reason || null,
      opened_at: row.invitation?.opened_at || null,
      activation_started_at: row.invitation?.activation_started_at || null,
      activated_at: row.invitation?.activated_at || null,
      expires_at: row.invitation?.expires_at || null,
      executed_at: row.executed_at,
    }));

    return apiResponse({
      batch: {
        id: batch.id,
        filename: batch.filename,
        status: batch.status,
        hostel: batch.hostels,
        total_rows: batch.total_rows,
        valid_rows: batch.valid_rows,
        duplicate_rows: batch.duplicate_rows,
        imported_rows: batch.imported_rows,
        failed_rows: batch.failed_rows,
        uploaded_at: batch.uploaded_at,
        imported_at: batch.imported_at,
        import_summary: batch.import_summary,
      },
      funnel,
      rows,
    });
  } catch (error: any) {
    return apiError(
      error?.message || "Failed to load import batch",
      "BATCH_STATUS_ERROR",
      500
    );
  }
}

function buildFunnel(invitations: Array<{ status: string }>) {
  const counts = invitations.reduce(
    (acc, invitation) => {
      const status = invitation.status;
      if (status === "OPENED" || status === "ACTIVATION_STARTED" || status === "ACTIVATED") acc.opened += 1;
      if (status === "ACTIVATION_STARTED" || status === "ACTIVATED") acc.activation_started += 1;
      if (status === "ACTIVATED") acc.activated += 1;
      if (status === "EXPIRED") acc.expired += 1;
      acc.invited += 1;
      return acc;
    },
    { invited: 0, opened: 0, activation_started: 0, activated: 0, expired: 0 }
  );

  return {
    ...counts,
    open_rate: percent(counts.opened, counts.invited),
    activation_start_rate: percent(counts.activation_started, counts.invited),
    activation_rate: percent(counts.activated, counts.invited),
    expiry_rate: percent(counts.expired, counts.invited),
  };
}

function percent(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 1000) / 10;
}
