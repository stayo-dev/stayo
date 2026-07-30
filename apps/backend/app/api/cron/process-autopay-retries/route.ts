import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/cron/process-autopay-retries
 *
 * Deprecated and intentionally unscheduled.
 * Autopay retries were removed in the single-business migration.
 * Do not add this route back to vercel.json without a new autopay design.
 */
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { ok: false, message: "Decommissioned: autopay retries removed in single-business migration" },
    { status: 410 }
  );
}
