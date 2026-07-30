export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";

/**
 * GET /api/food/voting-periods/[id]/results
 * Per-meal-type vote tally, ranked by count desc (ties by item name).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { id } = await params;

  try {
    const scope = resolveOwnerScope(session);

    const period = await prisma.food_voting_periods.findFirst({
      where: { id, owner_id: scope.owner_id },
    });
    if (!period) return apiError("Voting period not found", "NOT_FOUND", 404);

    const tally = await prisma.food_votes.groupBy({
      by: ["meal_type", "menu_item_id"],
      where: { voting_period_id: id },
      _count: { _all: true },
    });

    const itemIds = Array.from(new Set(tally.map((t) => t.menu_item_id)));
    const items = itemIds.length
      ? await prisma.food_menu_items.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, meal_type: true } })
      : [];
    const itemById = new Map(items.map((i) => [i.id, i]));

    const totalVotes = tally.reduce((sum, t) => sum + t._count._all, 0);

    const byMealType: Record<string, Array<{ menu_item_id: string; name: string; votes: number }>> = {
      BREAKFAST: [],
      LUNCH: [],
      SNACKS: [],
      DINNER: [],
    };
    for (const row of tally) {
      const item = itemById.get(row.menu_item_id);
      byMealType[row.meal_type]?.push({
        menu_item_id: row.menu_item_id,
        name: item?.name ?? "(deleted item)",
        votes: row._count._all,
      });
    }
    for (const mealType of Object.keys(byMealType)) {
      byMealType[mealType].sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
    }

    return apiResponse({ votingPeriod: period, totalVotes, byMealType });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch voting results");
  }
}
