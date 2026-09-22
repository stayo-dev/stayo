export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { runStayGuardianSweep } from "@/src/services/stay/stay-guardian-sweep";

/**
 * 🕐 CRON — guardian stay updates backstop (ADR-233)
 * GET /api/cron/stay-guardian-sweep
 *
 * Re-attempts the guardian message for any LEAVE_STARTED or RETURNED event in
 * the last 48 hours whose inline send was lost — a crash, a cold start, a
 * provider outage. Deduped on `whatsapp_logs.idempotency_key`
 * (`stay_guardian:{eventId}`), so re-running is safe and an already-delivered
 * event costs one skipped reservation.
 *
 * Runs **once daily**, like every other cron here: Vercel's Hobby plan allows
 * exactly one run per day and rejects anything more frequent at deploy time.
 * The delay this implies is survivable only because both templates carry their
 * own date — see `stay-guardian-sweep.ts`.
 *
 * Protected by CRON_SECRET bearer token, same as every other cron here.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runStayGuardianSweep();
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 },
    );
  }
}
