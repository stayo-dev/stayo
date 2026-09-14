export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { stayService } from "@/src/services/stay/stay-service";
import { stayErrorResponse } from "@/src/services/stay/stay-errors";

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
    return apiResponse(await stayService.getPortfolioSummary(scope.owner_id));
  } catch (error) {
    return stayErrorResponse(error);
  }
}
