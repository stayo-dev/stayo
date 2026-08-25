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
 * Runs hourly rather than daily. An invitation expires at whatever time of day
 * it was created, so a once-a-day sweep would reach some people with 23 hours
 * left and others with barely one; hourly keeps the "expires in N hours" in the
 * message close to the truth. The de-duplication lives in the service, so
 * running often is safe — and re-running after a failure is the point.
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
