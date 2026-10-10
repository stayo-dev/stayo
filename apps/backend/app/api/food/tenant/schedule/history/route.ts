export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureMonthSchedule, firstOfMonthUtc } from "@/lib/services/food/month-carry-forward";

/**
 * GET /api/food/tenant/schedule/history
 * Every published month for the tenant's hostel, newest first.
 *
 * The current month is carried forward first (`month-carry-forward.ts`), so a
 * menu the owner published last month is shown as this month's without the
 * owner having to open the app. Never creates an empty row.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const tenant = await prisma.tenants.findFirst({
      where: { profile_id: session.sub },
      select: { hostel_id: true },
    });
    if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);

    const hostel = await prisma.hostels.findUnique({
      where: { id: tenant.hostel_id },
      select: { owner_id: true },
    });
    if (hostel?.owner_id) {
      await ensureMonthSchedule({
        hostelId: tenant.hostel_id,
        ownerId: hostel.owner_id,
        month: firstOfMonthUtc(new Date()),
        allowCreateEmpty: false,
      });
    }

    const schedules = await prisma.food_schedules.findMany({
      where: { hostel_id: tenant.hostel_id, status: "PUBLISHED" },
      orderBy: { month: "desc" },
      select: { id: true, month: true, published_at: true },
    });

    return apiResponse({ schedules });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch schedule history");
  }
}
