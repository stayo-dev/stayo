export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

/**
 * 🕐 CRON — Daily Abandonment Nudge Engine
 * GET /api/cron/onboarding-nudges
 *
 * Deprecated and intentionally unscheduled.
 * Owner onboarding nudges were removed in the single-business migration.
 * Keep this 410 route temporarily so old monitors or manual calls fail clearly.
 * Do not add this route back to vercel.json without a new onboarding-nudge design.
 */
export async function GET(_req: NextRequest) {
  return NextResponse.json(
    { ok: false, message: "Decommissioned: owner onboarding nudges removed in single-business migration" },
    { status: 410 }
  );
}
