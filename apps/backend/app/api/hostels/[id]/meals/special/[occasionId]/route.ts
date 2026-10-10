export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { specialMealService } from "@/src/services/meals/special-meal-service";
import { mealErrorResponse } from "@/src/services/meals/meal-errors";

/** PATCH { weekday?, mealType?, vegDish?, nonVegDish?, cutoffMinutesBefore?, noAnswerPolicy?, isActive? } — 409 if the new day+meal clashes. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; occasionId: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id, occasionId } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    return apiResponse({ occasion: await specialMealService.updateOccasion(id, occasionId, body) });
  } catch (error) {
    return mealErrorResponse(error);
  }
}

/** DELETE — removes the special meal with its answers and ready alerts. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; occasionId: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id, occasionId } = await params;
  try {
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    await specialMealService.deleteOccasion(id, occasionId);
    return apiResponse({ deleted: true });
  } catch (error) {
    return mealErrorResponse(error);
  }
}
