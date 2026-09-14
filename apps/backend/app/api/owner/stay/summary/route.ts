export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { stayService } from "@/src/services/stay/stay-service";
import { stayErrorResponse } from "@/src/services/stay/stay-errors";
import { mealForecastService } from "@/src/services/meals/meal-forecast-service";

/**
 * GET /api/owner/stay/summary — Owner Home's "Tonight" answers, portfolio-wide
 * with a per-hostel breakdown. No hostelId: portfolio scope, like
 * /api/owner/portfolio/summary. Composed here, not in portfolio-service
 * (which must not read raw tenant tables).
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  try {
    const scope = resolveOwnerScope(session);
    const summary = await stayService.getPortfolioSummary(scope.owner_id);
    // Same tolerance as the portfolio route's expense call: a failure here
    // leaves the Tonight row on its honest headcount rather than blanking it.
    const forecasts = await Promise.all(
      summary.hostels.map((h) =>
        mealForecastService
          .getForecast(h.hostelId, {})
          .then((f) => f.days[0]?.meals.find((m) => m.mealType === "DINNER") ?? null)
          .catch(() => null),
      ),
    );
    const learned = forecasts.filter((f) => f && f.basis === "learned");
    return apiResponse({
      ...summary,
      mealForecast:
        learned.length > 0
          ? { expected: learned.reduce((total, f) => total + (f?.expected ?? 0), 0), basis: "learned" as const }
          : null,
    });
  } catch (error) {
    return stayErrorResponse(error);
  }
}
