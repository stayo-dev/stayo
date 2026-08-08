export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { prisma } from "@/lib/db";
import { FoodMealType } from "@prisma/client";
import { assignWeekForMealType, type RankedFoodItem } from "@/lib/services/food-schedule-generator";
import { decideRebuild, type RebuildMode } from "@/lib/services/food/schedule-rebuild-policy";

const MEAL_TYPES: FoodMealType[] = [FoodMealType.BREAKFAST, FoodMealType.LUNCH, FoodMealType.SNACKS, FoodMealType.DINNER];

/** Thrown inside the transaction when the month was published mid-request — rolls it back, answers 409 like the early check. */
const PUBLISHED_RACE = "SCHEDULE_PUBLISHED";

function firstOfMonth(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * POST /api/food/schedules/generate
 * Body: { hostelId, month: "YYYY-MM", votingPeriodId?, mode?: "BUILD" | "FILL_GAPS" | "START_OVER" }
 *
 * Builds each meal type's week from the Food Library (all active items,
 * alphabetically) via `assignWeekForMealType`. Voting-based ranking is opt-in
 * only — it runs solely when a caller explicitly passes `votingPeriodId`; no
 * current caller does, since schedule generation is decoupled from voting
 * (voting/polling is planned as a separate future feature).
 *
 * What it is permitted to overwrite is decided by `decideRebuild` — a PUBLISHED
 * month is never demoted to DRAFT and never wholesale deleted, because tenants
 * read published rows directly. `FILL_GAPS` is the only mode allowed against a
 * published month; it writes unassigned cells only.
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
    const mode: RebuildMode = ["BUILD", "FILL_GAPS", "START_OVER"].includes(body.mode) ? body.mode : "BUILD";
    const { votingPeriodId } = body;

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const month = firstOfMonth(monthStr);
    if (!month) return apiError("month is required (YYYY-MM)", "VALIDATION_ERROR", 400);

    const existing = await prisma.food_schedules.findUnique({
      where: { hostel_id_month: { hostel_id: hostelId, month } },
      select: { status: true },
    });
    const decision = decideRebuild({ mode, currentStatus: existing?.status ?? null });
    if (!decision.allowed) {
      return apiError(decision.reason, "SCHEDULE_PUBLISHED", 409);
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
      // Re-assert the decision inside the transaction. The status read above is
      // separated from this write by 5-9 generator round-trips, so a second
      // device can publish the month in between — and acting on the stale
      // decision would delete a published week out from under every tenant.
      const current = await tx.food_schedules.findUnique({
        where: { hostel_id_month: { hostel_id: hostelId, month } },
        select: { status: true },
      });
      const settled = decideRebuild({ mode, currentStatus: current?.status ?? null });
      if (!settled.allowed) throw new Error(`${PUBLISHED_RACE}: ${settled.reason}`);

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
          ...(settled.nextStatus ? { status: settled.nextStatus } : {}),
          // Provenance belongs to whoever authored the week. A FILL_GAPS run
          // adds cells and claims nothing (see `rewritesProvenance`).
          ...(settled.rewritesProvenance
            ? { source: "GENERATED" as const, generated_from_voting_period_id: votingPeriodId ?? null }
            : {}),
          updated_at: new Date(),
        },
      });

      const rows = MEAL_TYPES.flatMap((mealType) =>
        assignmentsByMealType[mealType].map((a) => ({
          schedule_id: upserted.id,
          day_of_week: a.day_of_week,
          meal_type: mealType,
          menu_item_id: a.menu_item_id,
          item_name: a.item_name,
        })),
      );

      if (settled.replace === "ALL") {
        await tx.food_schedule_meals.deleteMany({ where: { schedule_id: upserted.id } });
        await tx.food_schedule_meals.createMany({ data: rows });
      } else {
        // EMPTY_ONLY — replace only cells that were never assigned an item.
        await tx.food_schedule_meals.deleteMany({
          where: { schedule_id: upserted.id, menu_item_id: null },
        });
        const kept = await tx.food_schedule_meals.findMany({
          where: { schedule_id: upserted.id },
          select: { day_of_week: true, meal_type: true },
        });
        const taken = new Set(kept.map((k) => `${k.day_of_week}|${k.meal_type}`));
        const gapRows = rows.filter((r) => !taken.has(`${r.day_of_week}|${r.meal_type}`));
        if (gapRows.length > 0) await tx.food_schedule_meals.createMany({ data: gapRows });
      }

      return tx.food_schedules.findUnique({
        where: { id: upserted.id },
        include: { food_schedule_meals: true },
      });
    });

    return apiResponse(schedule, 201);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to generate schedule");
    if (msg.startsWith(PUBLISHED_RACE)) return apiError(msg.split(": ")[1] ?? msg, "SCHEDULE_PUBLISHED", 409);
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}
