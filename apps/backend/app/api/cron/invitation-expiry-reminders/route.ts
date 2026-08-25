export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { invitationExpiryReminderService } from "@/src/services/tenants/invitation-expiry-reminder-service";

/**
 * 🕐 CRON — Tenant invitation expiry reminders
 * GET /api/cron/invitation-expiry-reminders
 *
 * Sends `stayo_tenant_invitation_expiry_reminder` to anyone whose activation
 * link dies within 24 hours and who has not been reminded about that particular
 * invitation yet.
 *
 * Runs **once daily**. Vercel's Hobby plan allows exactly one cron run per day
 * and rejects anything more frequent **at deploy time** — an hourly schedule
 * does not degrade, it fails the deployment outright. The reminder window is
 * widened to 36 hours to suit that cadence (see REMINDER_WINDOW_HOURS), so
 * every invitation is still seen with at least 12 hours left.
 *
 * The de-duplication lives in the service, keyed per invitation, so running
 * more often — should the plan ever allow it — is safe and needs no change here
 * beyond the schedule.
 *
 * Protected by CRON_SECRET bearer token, same as every other cron here.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[CRON] CRON_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const result = await invitationExpiryReminderService.run(new Date());
    return NextResponse.json({
      ok: true,
      ...result,
      duration_ms: Date.now() - startedAt,
    });
  } catch (error: any) {
    console.error("[CRON] invitation-expiry-reminders failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Reminder run failed" },
      { status: 500 },
    );
  }
}
