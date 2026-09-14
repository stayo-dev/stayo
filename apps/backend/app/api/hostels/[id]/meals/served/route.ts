export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { mealForecastService } from "@/src/services/meals/meal-forecast-service";
import { mealErrorResponse } from "@/src/services/meals/meal-errors";

/**
 * PUT /api/hostels/[id]/meals/served
 * Body: { serveDate, mealType, servedCount }
 *
 * What the kitchen actually served — the measurement every forecast is learned
 * from. PUT, not POST: there is one truth per hostel, date and meal, and
 * re-entering it corrects a typo rather than adding a second opinion. See ADR-194.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    const entry = await mealForecastService.recordServed({
      hostelId: id,
      serveDate: body?.serveDate,
      mealType: body?.mealType,
      servedCount: body?.servedCount,
      recordedBy: session.sub,
    });
    return apiResponse({ entry });
  } catch (error) {
    return mealErrorResponse(error);
  }
}
