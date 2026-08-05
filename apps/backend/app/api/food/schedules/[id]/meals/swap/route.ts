export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";
import { canSwap } from "@/lib/services/food/meal-swap";

/**
 * POST /api/food/schedules/[id]/meals/swap
 * Body: { aMealId, bMealId }
 *
 * Exchanges the items of two cells in ONE transaction. Doing this as two
 * sequential PATCHes is not equivalent: a failure between them leaves one meal
 * duplicated and the other lost, on a schedule tenants may already be reading.
 *
 * Same blast radius as a single-cell edit — a cell is keyed by weekday, so a
 * swap moves both meals for the whole month, not one date.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { id: scheduleId } = await params;

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const { aMealId, bMealId } = body;
    if (typeof aMealId !== "string" || typeof bMealId !== "string") {
      return apiError("aMealId and bMealId are required", "VALIDATION_ERROR", 400);
    }

    const schedule = await prisma.food_schedules.findFirst({
      where: { id: scheduleId, owner_id: scope.owner_id },
      select: { id: true },
    });
    if (!schedule) return apiError("Schedule not found", "NOT_FOUND", 404);

    const updated = await prisma.$transaction(async (tx: any) => {
      const cells = await tx.food_schedule_meals.findMany({
        where: { id: { in: [aMealId, bMealId] } },
        select: { id: true, schedule_id: true, meal_type: true, menu_item_id: true, item_name: true },
      });
      const a = cells.find((c: any) => c.id === aMealId) ?? null;
      const b = cells.find((c: any) => c.id === bMealId) ?? null;

      const verdict = canSwap(a, b, scheduleId);
      if (!verdict.ok) throw new Error(`SWAP_REFUSED: ${verdict.reason}`);

      const now = new Date();
      await tx.food_schedule_meals.update({
        where: { id: a!.id },
        data: { menu_item_id: b!.menu_item_id, item_name: b!.item_name, updated_at: now },
      });
      await tx.food_schedule_meals.update({
        where: { id: b!.id },
        data: { menu_item_id: a!.menu_item_id, item_name: a!.item_name, updated_at: now },
      });

      await tx.food_schedules.update({
        where: { id: scheduleId },
        data: { source: "MANUAL", updated_at: now },
      });

      return tx.food_schedule_meals.findMany({
        where: { id: { in: [aMealId, bMealId] } },
      });
    });

    return apiResponse({ meals: updated });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to swap meals");
    if (msg.startsWith("SWAP_REFUSED")) return apiError(msg.split(": ")[1] ?? msg, "VALIDATION_ERROR", 400);
    return apiError(msg);
  }
}
