export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { settlementRunService } from "@/src/services/settlements/settlement-run-service";
import { settlementError, requireSettlementAdmin } from "@/src/services/settlements/settlement-http";

/** Today in IST — the run an admin sits down to at night. */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * GET /api/admin/settlements/run?date=YYYY-MM-DD
 *
 * Returns null when no run exists for that day — the console then offers to
 * create one rather than inventing totals.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireSettlementAdmin(session);
    const date = new URL(req.url).searchParams.get("date") || istToday();
    return apiResponse({ date, ...(await settlementRunService.getRun(date)) });
  } catch (error: any) {
    return settlementError(error, apiError);
  }
}

/**
 * POST /api/admin/settlements/run — build the run for a date.
 *
 * Idempotent per date: `run_date` is unique, so pressing this twice returns
 * the existing run rather than splitting a day across two.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireSettlementAdmin(session);
    const body = await req.json().catch(() => ({}));
    const date = String(body?.date || istToday());
    return apiResponse(await settlementRunService.createOrGetRun(date, session.sub));
  } catch (error: any) {
    return settlementError(error, apiError);
  }
}
