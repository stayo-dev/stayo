export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { prisma } from "@/lib/db";
import { FoodMealType } from "@prisma/client";

const VALID_MEAL_TYPES: string[] = Object.values(FoodMealType);

/**
 * GET /api/food/menu-items?hostelId=&mealType=&includeInactive=
 * List the hostel's food-item library, optionally filtered by meal type.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const { searchParams } = new URL(req.url);
    const hostelId = searchParams.get("hostelId");
    const mealType = searchParams.get("mealType") || undefined;
    const includeInactive = searchParams.get("includeInactive") === "true";

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    if (mealType && !VALID_MEAL_TYPES.includes(mealType)) {
      return apiError(`mealType must be one of: ${VALID_MEAL_TYPES.join(", ")}`, "VALIDATION_ERROR", 400);
    }

    const items = await prisma.food_menu_items.findMany({
      where: {
        hostel_id: hostelId!,
        ...(mealType ? { meal_type: mealType as FoodMealType } : {}),
        ...(includeInactive ? {} : { is_active: true }),
      },
      orderBy: [{ meal_type: "asc" }, { name: "asc" }],
    });

    return apiResponse({ items });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch food menu items");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}

/**
 * POST /api/food/menu-items
 * Add a new item to the hostel's food library.
 * Body: { hostelId, mealType, name }
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const { hostelId, mealType, name } = body;

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    if (!mealType || !VALID_MEAL_TYPES.includes(mealType)) {
      return apiError(`mealType must be one of: ${VALID_MEAL_TYPES.join(", ")}`, "VALIDATION_ERROR", 400);
    }
    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (!trimmedName) {
      return apiError("name is required", "VALIDATION_ERROR", 400);
    }

    const existing = await prisma.food_menu_items.findFirst({
      where: { hostel_id: hostelId, meal_type: mealType as FoodMealType, name: trimmedName },
    });
    if (existing) {
      if (!existing.is_active) {
        const reactivated = await prisma.food_menu_items.update({
          where: { id: existing.id },
          data: { is_active: true, updated_at: new Date() },
        });
        return apiResponse(reactivated, 200);
      }
      return apiError("An item with this name already exists for this meal type", "VALIDATION_ERROR", 409);
    }

    const item = await prisma.food_menu_items.create({
      data: {
        hostel_id: hostelId,
        owner_id: scope.owner_id,
        meal_type: mealType as FoodMealType,
        name: trimmedName,
      },
    });

    return apiResponse(item, 201);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to create food menu item");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}
