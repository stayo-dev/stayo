export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSession, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolvePreferences } from "@/lib/preferences";
import { buildImportWorkbook } from "@/lib/services/bulk-import/template-builder";

/**
 * 📥 GET /api/bulk-import/template?hostel_id=…
 *
 * The import workbook for one hostel — not a generic file. It arrives with
 * the hostel's rooms already in it and a Room dropdown bound to them, so the
 * owner retypes nothing we already know and cannot mistype a room number.
 * The hostel's id is stamped on a locked cover sheet, because every hostel
 * has a room 101 and importing the wrong hostel's file would put tenants in
 * the wrong rooms without reporting anything wrong.
 *
 * Access: Owner/Admin, and only for a hostel they own.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Only owners/admins can download import templates", "FORBIDDEN", 403);
  }

  const hostelId = req.nextUrl.searchParams.get("hostel_id");
  if (!hostelId) {
    return apiError(
      "Choose which hostel you're importing into — the template is built from that hostel's rooms.",
      "VALIDATION_ERROR",
      400
    );
  }

  const hostel = await prisma.hostels.findFirst({
    where: { id: hostelId, owner_id: session.sub },
    select: { id: true, name: true, preferences_config: true },
  });
  if (!hostel) {
    return apiError("Hostel not found or access denied", "NOT_FOUND", 404);
  }

  const [rooms, tenantCount] = await Promise.all([
    prisma.rooms.findMany({
      where: { hostel_id: hostelId },
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
    prisma.tenants.count({ where: { hostel_id: hostelId, status: "ACTIVE" } }),
  ]);

  const resolvedDueDay = Number(resolvePreferences(hostel).due_day);
  const dueDay = resolvedDueDay >= 1 && resolvedDueDay <= 28 ? resolvedDueDay : 5;

  const workbook = await buildImportWorkbook({
    hostel: { id: hostel.id, name: hostel.name },
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
  });

  const slug =
    hostel.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "hostel";

  return new NextResponse(workbook as any, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${slug}-tenant-import.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
