export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";

/**
 * PATCH /api/food/schedules/[id]/meals/[mealId]
 * Owner edits one cell — swaps the item for that day+meal type.
 * Body: { menuItemId }
 *
 * Note the blast radius: a cell is keyed by (schedule, day_of_week, meal_type),
 * so this changes that weekday for the **whole month**, not one date. Per-date
 * overrides need `serve_date`, which does not exist yet.
 *
 * If the schedule is already PUBLISHED this row is what tenants read, so the
 * edit is live immediately — the client surfaces that with an undo affordance
 * rather than a staging step.
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
    const { menuItemId } = body;
    if (!menuItemId || typeof menuItemId !== "string") {
      return apiError("menuItemId is required", "VALIDATION_ERROR", 400);
    }

    const schedule = await prisma.food_schedules.findFirst({
      where: { id: scheduleId, owner_id: scope.owner_id },
    });
    if (!schedule) return apiError("Schedule not found", "NOT_FOUND", 404);

    const meal = await prisma.food_schedule_meals.findFirst({
      where: { id: mealId, schedule_id: scheduleId },
    });
    if (!meal) return apiError("Meal cell not found", "NOT_FOUND", 404);

    const item = await prisma.food_menu_items.findFirst({
      where: { id: menuItemId, hostel_id: schedule.hostel_id, meal_type: meal.meal_type, is_active: true },
    });
    if (!item) return apiError("That item isn't available for this meal type", "VALIDATION_ERROR", 400);

    const updated = await prisma.food_schedule_meals.update({
      where: { id: mealId },
      data: { menu_item_id: item.id, item_name: item.name, updated_at: new Date() },
    });

    await prisma.food_schedules.update({
      where: { id: scheduleId },
      data: { source: "MANUAL", updated_at: new Date() },
    });

    return apiResponse(updated);
  } catch (error: any) {
    return apiError(error?.message || "Failed to update meal");
  }
}
