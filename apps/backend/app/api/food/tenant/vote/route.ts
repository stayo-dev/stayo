export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FoodMealType } from "@prisma/client";

const VALID_MEAL_TYPES: string[] = Object.values(FoodMealType);

function firstOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * POST /api/food/tenant/vote
 * Toggle this tenant's vote for one item within one meal type in the current
 * month's voting period — tenants may select multiple items per meal type,
 * so this adds the vote if it doesn't exist yet, or removes it if it does.
 * Body: { mealType, menuItemId }
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { mealType, menuItemId } = body;

    if (!mealType || !VALID_MEAL_TYPES.includes(mealType)) {
      return apiError(`mealType must be one of: ${VALID_MEAL_TYPES.join(", ")}`, "VALIDATION_ERROR", 400);
    }
    if (!menuItemId || typeof menuItemId !== "string") {
      return apiError("menuItemId is required", "VALIDATION_ERROR", 400);
    }

    const tenant = await prisma.tenants.findFirst({
      where: { profile_id: session.sub },
      select: { id: true, hostel_id: true },
    });
    if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);

    const month = firstOfMonth(new Date());
    const period = await prisma.food_voting_periods.findUnique({
      where: { hostel_id_month: { hostel_id: tenant.hostel_id, month } },
    });
    if (!period || period.status !== "OPEN") {
      return apiError("Voting is not open right now", "VOTING_CLOSED", 409);
    }
    const now = new Date();
    if (now < period.voting_starts_at || now > period.voting_ends_at) {
      return apiError("Voting is not open right now", "VOTING_CLOSED", 409);
    }

    const item = await prisma.food_menu_items.findFirst({
      where: { id: menuItemId, hostel_id: tenant.hostel_id, meal_type: mealType as FoodMealType, is_active: true },
    });
    if (!item) return apiError("That item is not available to vote for", "NOT_FOUND", 404);

    const whereKey = {
      voting_period_id_tenant_id_meal_type_menu_item_id: {
        voting_period_id: period.id,
        tenant_id: tenant.id,
        meal_type: mealType as FoodMealType,
        menu_item_id: menuItemId,
      },
    };

    const existing = await prisma.food_votes.findUnique({ where: whereKey });
    if (existing) {
      await prisma.food_votes.delete({ where: whereKey });
      return apiResponse({ menu_item_id: menuItemId, meal_type: mealType, voted: false });
    }

    await prisma.food_votes.create({
      data: { voting_period_id: period.id, tenant_id: tenant.id, meal_type: mealType as FoodMealType, menu_item_id: menuItemId },
    });
    return apiResponse({ menu_item_id: menuItemId, meal_type: mealType, voted: true });
  } catch (error: any) {
    return apiError(error?.message || "Failed to record vote");
  }
}
