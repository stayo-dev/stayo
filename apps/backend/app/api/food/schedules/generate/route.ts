export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { prisma } from "@/lib/db";
import { FoodMealType } from "@prisma/client";
import { assignWeekForMealType, type RankedFoodItem } from "@/lib/services/food-schedule-generator";

const MEAL_TYPES: FoodMealType[] = [FoodMealType.BREAKFAST, FoodMealType.LUNCH, FoodMealType.SNACKS, FoodMealType.DINNER];

function firstOfMonth(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * POST /api/food/schedules/generate
 * Body: { hostelId, month: "YYYY-MM", votingPeriodId? }
 * Ranks each meal type's library items by real vote count (falling back to
 * all active library items, alphabetically, if no votes exist yet), assigns
 * one item per weekday via `assignWeekForMealType`, and upserts the DRAFT
 * schedule + its 28 meal rows. Re-running overwrites the previous generation
 * — always safe since nothing is published until the owner explicitly publishes.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const { hostelId, month: monthStr } = body;
    let { votingPeriodId } = body;

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const month = firstOfMonth(monthStr);
    if (!month) return apiError("month is required (YYYY-MM)", "VALIDATION_ERROR", 400);

    if (!votingPeriodId) {
      const period = await prisma.food_voting_periods.findUnique({
        where: { hostel_id_month: { hostel_id: hostelId, month } },
      });
      votingPeriodId = period?.id;
    }

    const assignmentsByMealType: Record<string, ReturnType<typeof assignWeekForMealType>> = {};

    for (const mealType of MEAL_TYPES) {
      let ranked: RankedFoodItem[] = [];

      if (votingPeriodId) {
        const tally = await prisma.food_votes.groupBy({
          by: ["menu_item_id"],
          where: { voting_period_id: votingPeriodId, meal_type: mealType },
          _count: { _all: true },
        });
        if (tally.length > 0) {
          const items = await prisma.food_menu_items.findMany({
            where: { id: { in: tally.map((t) => t.menu_item_id) } },
            select: { id: true, name: true },
          });
          const nameById = new Map(items.map((i) => [i.id, i.name]));
          ranked = tally
            .map((t) => ({ id: t.menu_item_id, name: nameById.get(t.menu_item_id) ?? "(deleted item)", votes: t._count._all }))
            .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
        }
      }

      if (ranked.length === 0) {
        const items = await prisma.food_menu_items.findMany({
          where: { hostel_id: hostelId, meal_type: mealType, is_active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        });
        ranked = items.map((i) => ({ id: i.id, name: i.name, votes: 0 }));
      }

      assignmentsByMealType[mealType] = assignWeekForMealType(ranked);
    }

    const schedule = await prisma.$transaction(async (tx) => {
      const upserted = await tx.food_schedules.upsert({
        where: { hostel_id_month: { hostel_id: hostelId, month } },
        create: {
          hostel_id: hostelId,
          owner_id: scope.owner_id,
          month,
          status: "DRAFT",
          source: "GENERATED",
          generated_from_voting_period_id: votingPeriodId ?? null,
        },
        update: {
          status: "DRAFT",
          source: "GENERATED",
          generated_from_voting_period_id: votingPeriodId ?? null,
          updated_at: new Date(),
        },
      });

      await tx.food_schedule_meals.deleteMany({ where: { schedule_id: upserted.id } });

      const rows = MEAL_TYPES.flatMap((mealType) =>
        assignmentsByMealType[mealType].map((a) => ({
          schedule_id: upserted.id,
          day_of_week: a.day_of_week,
          meal_type: mealType,
          menu_item_id: a.menu_item_id,
          item_name: a.item_name,
        })),
      );
      await tx.food_schedule_meals.createMany({ data: rows });

      return tx.food_schedules.findUnique({
        where: { id: upserted.id },
        include: { food_schedule_meals: true },
      });
    });

    return apiResponse(schedule, 201);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to generate schedule");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}
