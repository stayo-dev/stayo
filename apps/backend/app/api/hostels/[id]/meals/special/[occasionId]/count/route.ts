export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { specialMealService } from "@/src/services/meals/special-meal-service";
import { mealErrorResponse } from "@/src/services/meals/meal-errors";

/** GET ?date=YYYY-MM-DD (defaults to the next serving) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; occasionId: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id, occasionId } = await params;
  try {
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    const date = new URL(req.url).searchParams.get("date") ?? undefined;
    return apiResponse(await specialMealService.getCount(id, occasionId, date));
  } catch (error) {
    return mealErrorResponse(error);
  }
}
