export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { hostelInvariantValidator } from "@/lib/services/hostel-invariant-validator";
import { financialInvariantService } from "@/lib/services/financial-invariant-service";

/**
 * 🔒 CRON — Nightly Hostel Invariant Validation
 * GET /api/cron/hostel-invariants
 *
 * Runs all 5 canonical hostel_id invariant checks and reports violations.
 * Called nightly by Vercel Cron. Protected by CRON_SECRET.
 *
 * Invariants checked:
 * 1. payment.hostel_id === obligation.hostel_id
 * 2. receipt.hostel_id === payment.hostel_id
 * 3. reminder.hostel_id === obligation.hostel_id
 * 4. allocation.hostel_id === room.hostel_id
 * 5. tenant.hostel_id === active_allocation.room.hostel_id
 *
 * Also reports backfill completeness (% of records with hostel_id filled).
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

  const startTime = Date.now();

  try {
    const [invariantReport, completeness, financialInvariants] = await Promise.all([
      hostelInvariantValidator.runAllChecks(),
      hostelInvariantValidator.checkBackfillCompleteness(),
      financialInvariantService.runAll(),
    ]);

    const durationMs = Date.now() - startTime;

    console.log(`[CRON] Hostel invariant check complete in ${durationMs}ms:`, {
      total_checked: invariantReport.total_checked,
      violations: invariantReport.violations,
    });

    if (invariantReport.violations > 0) {
      console.warn(
        `[ALERT] ${invariantReport.violations} hostel invariant violations detected!`,
        invariantReport.checks
          .filter((c) => c.violations > 0)
          .map((c) => `${c.name}: ${c.violations}`)
      );
    }

    return NextResponse.json({
      success: true,
      duration_ms: durationMs,
      invariants: invariantReport,
      financial_invariants: financialInvariants,
      backfill_completeness: completeness,
    });
  } catch (error: any) {
    console.error("[CRON] Hostel invariant check failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Hostel invariant validation pipeline failed.",
      },
      { status: 500 }
    );
  }
}
