export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { reminderService } from "@/src/services/payments/reminder-service";

/**
 * 🕐 CRON — Daily Reminder & Late Fee Engine
 * GET /api/cron/rent-reminders
 * 
 * Called by Vercel Cron daily at 02:00 server time.
 * Protected by CRON_SECRET bearer token.
 */
export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[CRON] CRON_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const summary = await reminderService.processDailyReminders();
    const durationMs = Date.now() - startTime;

    console.log(`[CRON] Rent reminders complete in ${durationMs}ms:`, summary);

    // Optional Threshold alerting: Log critical if it was hanging or failed somewhere inside
    if (durationMs > 20_000) {
      console.warn("[ALERT] CRON rent-reminders execution exceeded 20s warning threshold!");
    }

    return NextResponse.json({
      success: true,
      duration_ms: durationMs,
      ...summary
    });
  } catch (error: any) {
    console.error("[CRON] Rent reminders failed:", error);
    return NextResponse.json({
      success: false,
      error: error.message || "Rent Reminders generation pipeline failed."
    }, { status: 500 });
  }
}
