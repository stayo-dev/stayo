export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { portfolioService } from "@/lib/services/portfolio-service";

/**
 * GET /api/owner/portfolio/summary
 *
 * Returns the authenticated owner's portfolio summary: per-hostel cards
 * (from hostel_daily_snapshots) + owner-level aggregate (from portfolio cache).
 *
 * No hostelId parameter — this is the portfolio (owner) scope.
 * Operational data must never be fetched from this route.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const summary = await portfolioService.getPortfolioSummary(session.sub);
    return apiResponse(summary);
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch portfolio summary");
  }
}
