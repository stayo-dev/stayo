export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

/**
 * 🕐 CRON — Monthly Overflow Billing
 * GET /api/cron/process-overflow
 *
 * Runs on the 2nd of every month (day after rent generation).
 * Protected by CRON_SECRET bearer token.
 * Idempotent: safe to call multiple times for the same billing month.
 *
 * Deprecated and intentionally unscheduled.
 * Keep this 410 route temporarily so old monitors or manual calls fail clearly.
 * Do not add this route back to vercel.json without a new overflow-billing design.
 */
export async function GET(_req: NextRequest) {
  return NextResponse.json(
    { ok: false, message: "Decommissioned: overflow billing removed in single-business migration" },
    { status: 410 }
  );
}
