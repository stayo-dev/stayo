export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";

/**
 * PATCH /api/food/menu-items/[id]
 * Rename an item and/or toggle its active state.
 * Body: { name?, isActive? }
 */
export async function PATCH(
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
    const body = await req.json().catch(() => ({}));

    const item = await prisma.food_menu_items.findFirst({
      where: { id, owner_id: scope.owner_id },
    });
    if (!item) return apiError("Food menu item not found", "NOT_FOUND", 404);

    const data: { name?: string; is_active?: boolean; updated_at: Date } = { updated_at: new Date() };
    if (typeof body.name === "string") {
      const trimmed = body.name.trim();
      if (!trimmed) return apiError("name cannot be empty", "VALIDATION_ERROR", 400);
      data.name = trimmed;
    }
    if (typeof body.isActive === "boolean") {
      data.is_active = body.isActive;
    }

    const updated = await prisma.food_menu_items.update({ where: { id }, data });
    return apiResponse(updated);
  } catch (error: any) {
    return apiError(error?.message || "Failed to update food menu item");
  }
}

/**
 * DELETE /api/food/menu-items/[id]
 * Soft-delete only — sets is_active=false. Never hard-deletes, since past
 * `food_schedule_meals` rows may reference this item (its `item_name` snapshot
 * survives regardless, but the live reference is kept for as long as it exists).
 */
export async function DELETE(
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

    const item = await prisma.food_menu_items.findFirst({
      where: { id, owner_id: scope.owner_id },
    });
    if (!item) return apiError("Food menu item not found", "NOT_FOUND", 404);

    await prisma.food_menu_items.update({
      where: { id },
      data: { is_active: false, updated_at: new Date() },
    });

    return apiResponse({ success: true });
  } catch (error: any) {
    return apiError(error?.message || "Failed to delete food menu item");
  }
}
