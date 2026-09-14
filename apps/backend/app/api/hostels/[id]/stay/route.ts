export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { stayService } from "@/src/services/stay/stay-service";
import { stayErrorResponse } from "@/src/services/stay/stay-errors";
import { mealForecastService } from "@/src/services/meals/meal-forecast-service";

/**
 * GET /api/hostels/[id]/stay — the owner's Stay board for one hostel:
 * here tonight, meals, back today, late, rooms to check, beds free.
 * Answers, not states. See ADR-194.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id } = await params;
  try {
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    // Composed here, not inside either service: meals may read Stay, Stay must
    // never read meals. A meals failure must not cost the owner their board.
    const [board, forecast] = await Promise.all([
      stayService.getHostelBoard(id),
      mealForecastService.getForecast(id, {}).catch(() => null),
    ]);
    const dinner = forecast?.days[0]?.meals.find((m) => m.mealType === "DINNER") ?? null;
    return apiResponse({
      ...board,
      mealForecast: dinner ? { expected: dinner.expected, basis: dinner.basis, samples: dinner.samples } : null,
    });
  } catch (error) {
    return stayErrorResponse(error);
  }
}
