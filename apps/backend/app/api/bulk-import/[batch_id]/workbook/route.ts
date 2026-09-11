export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSession, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolvePreferences } from "@/lib/preferences";
import { buildImportWorkbook } from "@/lib/services/bulk-import/template-builder";

/**
 * 📄 GET /api/bulk-import/[batch_id]/workbook
 *
 * The owner's own file back, with the fixes they made on screen already in it.
 *
 * Small corrections — a digit missing from a phone, a room from the wrong
 * hostel — are made in the review screen rather than back in Excel. That would
 * leave the spreadsheet on their machine out of step with what Stayo has, and
 * re-uploading it later would undo the work. So the corrected batch is handed
 * back as a workbook: same shape, same dropdowns, their fixes in place.
 *
 * Access: Owner/Admin, and only their own batch.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { batch_id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Only owners/admins can download an import", "FORBIDDEN", 403);
  }

  const batch = await prisma.bulk_import_batches.findFirst({
    where: { id: params.batch_id, owner_id: session.sub },
    include: { hostel: { select: { id: true, name: true, preferences_config: true } } },
  });
  if (!batch) return apiError("Batch not found", "NOT_FOUND", 404);

  const payload = (batch.validation_errors ?? {}) as any;
  // Every row the batch knows about, back in the owner's own order.
  const rows = [
    ...(Array.isArray(payload.valid_rows) ? payload.valid_rows : []),
    ...(Array.isArray(payload.invalid) ? payload.invalid : []),
    ...(Array.isArray(payload.duplicates) ? payload.duplicates : []),
  ]
    .slice()
    .sort((a: any, b: any) => Number(a.row ?? 0) - Number(b.row ?? 0))
    .map((entry: any) => ({ ...(entry.data ?? {}), __issues: entry.issues ?? [] }));

  const [rooms, tenantCount] = await Promise.all([
    prisma.rooms.findMany({
      where: { hostel_id: batch.hostel_id },
      select: {
        room_no: true,
        floor: true,
        capacity: true,
        room_type: true,
        base_rent: true,
        _count: {
          select: {
            room_allocations: {
              where: { is_active: true, end_date: null, tenant: { status: "ACTIVE" } },
            },
          },
        },
      },
      orderBy: [{ floor: "asc" }, { room_no: "asc" }],
    }),
    prisma.tenants.count({ where: { hostel_id: batch.hostel_id, status: "ACTIVE" } }),
  ]);

  const resolvedDueDay = Number(resolvePreferences(batch.hostel).due_day);
  const dueDay = resolvedDueDay >= 1 && resolvedDueDay <= 28 ? resolvedDueDay : 5;

  const workbook = await buildImportWorkbook({
    hostel: { id: batch.hostel.id, name: batch.hostel.name },
    dueDay,
    rooms: rooms.map((room: any) => ({
      room_no: room.room_no,
      floor: room.floor,
      capacity: room.capacity,
      room_type: room.room_type,
      base_rent: room.base_rent,
      occupied_count: room._count?.room_allocations ?? 0,
    })),
    tenantCount,
    tenants: rows.map((row: any) => ({
      name: row.name,
      phone: row.phone,
      email: row.email,
      room_no: row.room_no,
      monthly_rent: row.monthly_rent,
      joining_date: row.joining_date,
      security_deposit: row.security_deposit ?? row.advance_deposit,
      maintenance_charge: row.maintenance_charge,
      maintenance_type: row.maintenance_type,
      agreement_duration_months: row.agreement_duration_months,
      amount_paid: row.amount_paid,
      amount_includes_deposit: row.amount_includes_deposit,
      payment_method: row.payment_method,
      payment_reference: row.payment_reference,
      notes: row.notes,
      // Still outstanding, so the sheet can mark exactly where.
      problems: (row.__issues ?? []).map((issue: any) => ({
        field: issue.field,
        severity: issue.severity,
        title: issue.title,
        detail: issue.detail,
      })),
    })),
  });

  const slug =
    batch.hostel.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "hostel";

  return new NextResponse(workbook as any, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${slug}-tenant-import-corrected.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
