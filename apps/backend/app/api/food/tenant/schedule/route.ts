export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

function firstOfMonth(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * GET /api/food/tenant/schedule?month=YYYY-MM
 * The published schedule for the tenant's own hostel (defaults to the
 * current month). Only ever returns a PUBLISHED row — a DRAFT schedule the
 * owner hasn't published yet is invisible to tenants, even for past months.
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

    const { searchParams } = new URL(req.url);
    const month = firstOfMonth(searchParams.get("month")) ?? firstOfMonth(new Date().toISOString());

    const schedule = await prisma.food_schedules.findFirst({
      where: { hostel_id: tenant.hostel_id, month: month!, status: "PUBLISHED" },
      include: { food_schedule_meals: true },
    });

    return apiResponse({ schedule });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch schedule");
  }
}
