export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";
import { validateMenuItemIds, deriveLegacyFields } from "@/lib/services/food/meal-items";

/**
 * PATCH /api/food/schedules/[id]/meals/[mealId]
 * Owner edits one cell — replaces its full item list for that day+meal type.
 * Body: { menuItemIds: string[], expectedUpdatedAt: string } (ordered; [] clears the meal)
 *
 * Note the blast radius: a cell is keyed by (schedule, day_of_week, meal_type),
 * so this changes that weekday for the **whole month**, not one date. Per-date
 * overrides need `serve_date`, which does not exist yet.
 *
 * If the schedule is already PUBLISHED this row is what tenants read, so the
 * edit is live immediately — the client surfaces that with an undo affordance
 * rather than a staging step.
 *
 * `expectedUpdatedAt` guards against a stale write from another tab/owner
 * silently clobbering a newer edit — the same conditional-`updateMany`
 * technique the (now-removed) meal-swap endpoint used, applied here to a
 * single cell. A mismatch means someone else's edit landed first; the caller
 * gets a 409 and is expected to refetch rather than retry blindly.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mealId: string }> }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { id: scheduleId, mealId } = await params;

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));

    const schedule = await prisma.food_schedules.findFirst({
      where: { id: scheduleId, owner_id: scope.owner_id },
    });
    if (!schedule) return apiError("Schedule not found", "NOT_FOUND", 404);

    const meal = await prisma.food_schedule_meals.findFirst({
      where: { id: mealId, schedule_id: scheduleId },
    });
    if (!meal) return apiError("Meal cell not found", "NOT_FOUND", 404);

    const allowed = await prisma.food_menu_items.findMany({
      where: { hostel_id: schedule.hostel_id, meal_type: meal.meal_type, is_active: true },
      select: { id: true, name: true },
    });

    const validated = validateMenuItemIds(body.menuItemIds, allowed);
    if (!validated.ok) return apiError(validated.reason, "VALIDATION_ERROR", 400);

    // `null` is a legitimate value here, not a missing one: a cell created by
    // `POST /api/food/schedules` and never yet edited has `updated_at: null`
    // in the database, so the caller's *honest* "what I last saw" is null too.
    // Rejecting that made the very first edit to any brand-new cell 400
    // forever (masked client-side by the optimistic update, which is why this
    // went unnoticed) — every one of the 28 cells in every newly-created
    // schedule was unreachable until it had somehow already been edited once.
    if (body.expectedUpdatedAt !== null && typeof body.expectedUpdatedAt !== "string") {
      return apiError("expectedUpdatedAt is required", "VALIDATION_ERROR", 400);
    }
    const expectedUpdatedAt = body.expectedUpdatedAt === null ? null : new Date(body.expectedUpdatedAt);
    if (expectedUpdatedAt !== null && Number.isNaN(expectedUpdatedAt.getTime())) {
      return apiError("expectedUpdatedAt is not a valid date", "VALIDATION_ERROR", 400);
    }

    const legacy = deriveLegacyFields(validated.items);

    const updated = await prisma.$transaction(async (tx) => {
      const now = new Date();
      // Conditional on the row's `updated_at` still matching what the caller
      // last saw — the same optimistic-concurrency technique the (now-removed)
      // meal-swap endpoint used, applied to a single cell. A mismatch means a
      // newer edit already landed (another tab, another owner/admin); refuse
      // rather than silently overwrite it.
      const guard = await tx.food_schedule_meals.updateMany({
        where: { id: mealId, updated_at: expectedUpdatedAt },
        data: { ...legacy, updated_at: now },
      });
      if (guard.count !== 1) {
        throw new Error("STALE_WRITE: This meal changed elsewhere — refresh and try again");
      }

      await tx.food_schedule_meal_items.deleteMany({ where: { schedule_meal_id: mealId } });
      if (validated.items.length > 0) {
        await tx.food_schedule_meal_items.createMany({
          data: validated.items.map((item, index) => ({
            schedule_meal_id: mealId,
            menu_item_id: item.menu_item_id,
            item_name: item.item_name,
            display_order: index,
          })),
        });
      }

      const meal = await tx.food_schedule_meals.findUniqueOrThrow({
        where: { id: mealId },
        include: { food_schedule_meal_items: { orderBy: { display_order: "asc" } } },
      });

      await tx.food_schedules.update({
        where: { id: scheduleId },
        data: { source: "MANUAL", updated_at: now },
      });

      return meal;
    });

    return apiResponse(updated);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to update meal");
    if (msg.startsWith("STALE_WRITE")) return apiError(msg.split(": ")[1] ?? msg, "STALE_WRITE", 409);
    return apiError(msg);
  }
}
