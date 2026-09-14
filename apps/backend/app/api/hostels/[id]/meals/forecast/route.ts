export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { mealForecastService } from "@/src/services/meals/meal-forecast-service";
import { mealErrorResponse } from "@/src/services/meals/meal-errors";

/**
 * GET /api/hostels/[id]/meals/forecast?from=&to=
 *
 * How many to cook for, per day and meal — learned from what this hostel
 * actually served, or the plain headcount while it is still learning.
 * Defaults to today and tomorrow, which is what the kitchen sheet shows.
 * See ADR-195.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id } = await params;
  try {
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    const url = new URL(req.url);
    const range: { from?: string; to?: string } = {};
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (from) range.from = from;
    if (to) range.to = to;
    return apiResponse(await mealForecastService.getForecast(id, range));
  } catch (error) {
    return mealErrorResponse(error);
  }
}
