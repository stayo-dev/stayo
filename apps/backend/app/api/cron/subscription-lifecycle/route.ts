export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { acquireSystemLock, releaseSystemLock } from "@/lib/lock";
import { subscriptionLifecycleService } from "@/src/services/platform-billing/subscription-lifecycle-service";

/**
 * 🕐 CRON — Owner subscription lifecycle (ADR-172, Phase 3)
 * GET /api/cron/subscription-lifecycle
 *
 * Pauses every owner subscription whose paid period has ended without an
 * approved renewal and without a valid admin override. **No grace period.**
 * Renewals and queued-downgrade application happen at payment-approval time
 * (`subscription-payment-service`), not here — this sweep is expiry only.
 *
 * Idempotent (status-guarded pause writes) and single-flighted via the existing
 * `system_locks` pattern. Bearer CRON_SECRET, same as every other cron here.
 * Actor for the events it emits is SYSTEM.
 */
const LOCK_KEY = "cron:subscription-lifecycle";

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
  const locked = await acquireSystemLock(LOCK_KEY, 300).catch(() => false);
  if (!locked) {
    return NextResponse.json({ ok: true, skipped: "locked", message: "Another run holds the lock" });
  }

  try {
    const result = await subscriptionLifecycleService.runExpirySweep(new Date());
    return NextResponse.json({ ok: true, ...result, duration_ms: Date.now() - startedAt });
  } catch (error: any) {
    console.error("[CRON] subscription-lifecycle failed:", error);
    return NextResponse.json({ ok: false, error: error?.message || "Lifecycle run failed" }, { status: 500 });
  } finally {
    await releaseSystemLock(LOCK_KEY);
  }
}
