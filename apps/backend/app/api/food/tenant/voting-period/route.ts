export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

function firstOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * GET /api/food/tenant/voting-period
 * The current month's voting period for the tenant's own hostel, plus
 * whatever library items exist per meal type and the tenant's existing picks.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const tenant = await prisma.tenants.findFirst({
      where: { profile_id: session.sub },
      select: { id: true, hostel_id: true },
    });
    if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);

    const month = firstOfMonth(new Date());
    const period = await prisma.food_voting_periods.findUnique({
      where: { hostel_id_month: { hostel_id: tenant.hostel_id, month } },
    });

    const items = await prisma.food_menu_items.findMany({
      where: { hostel_id: tenant.hostel_id, is_active: true },
      orderBy: [{ meal_type: "asc" }, { name: "asc" }],
      select: { id: true, meal_type: true, name: true },
    });

    const myVotes = period
      ? await prisma.food_votes.findMany({
          where: { voting_period_id: period.id, tenant_id: tenant.id },
          select: { meal_type: true, menu_item_id: true },
        })
      : [];

    return apiResponse({ votingPeriod: period, items, myVotes });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch voting period");
  }
}
