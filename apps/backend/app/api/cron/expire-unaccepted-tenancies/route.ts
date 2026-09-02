export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { unacceptedTenancyExpiryService } from "@/src/services/tenants/unaccepted-tenancy-expiry-service";

/**
 * 🕐 CRON — Expire unaccepted tenancies
 * GET /api/cron/expire-unaccepted-tenancies
 *
 * A new-model invitation makes the tenancy operationally live immediately
 * (`status = ACTIVE`, `acceptance_status = PENDING`) but the tenant must
 * personally accept (ADR-165). This sweep closes the ones that never did and
 * whose activation link expired more than GRACE_DAYS ago: it frees the room,
 * voids only future unpaid obligations, and keeps past dues + every recorded
 * payment for settlement. Terminal status EXPIRED.
 *
 * Runs once daily, an hour after `invitation-expiry-reminders`, so the invitee
 * has already had the day-before-expiry WhatsApp nudge plus the grace window.
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
    const result = await unacceptedTenancyExpiryService.run(new Date());
    return NextResponse.json({ ok: true, ...result, duration_ms: Date.now() - startedAt });
  } catch (error: any) {
    console.error("[CRON] expire-unaccepted-tenancies failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Expiry run failed" },
      { status: 500 },
    );
  }
}
