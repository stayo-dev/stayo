export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resetMetrics, getMetrics } from "@/lib/metrics";

/**
 * POST /api/metrics/reset
 *
 * Resets all in-process metrics counters and timing stats.
 * Used to isolate load-test windows without restarting the process.
 *
 * Auth: OWNER or ADMIN role required.
 * Note: In a multi-instance deployment counters are per-instance —
 * a reset only affects the instance that receives this request.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const beforeReset = getMetrics();
  const resetAt = new Date().toISOString();

  resetMetrics();

  return NextResponse.json({
    reset: true,
    reset_at: resetAt,
    // Return counters captured just before the reset — useful for archiving
    // a session's metrics before starting a new measurement window.
    snapshot_before_reset: {
      receipt_pdf_hits:              beforeReset.pdf_cache.receipt_hits,
      receipt_pdf_misses:            beforeReset.pdf_cache.receipt_misses,
      receipt_pdf_hit_rate_pct:      beforeReset.receipt_pdf_hit_rate_pct,
      invoice_pdf_hits:              beforeReset.pdf_cache.invoice_hits,
      invoice_pdf_misses:            beforeReset.pdf_cache.invoice_misses,
      invoice_pdf_hit_rate_pct:      beforeReset.invoice_pdf_hit_rate_pct,
      pdf_cache_contentions:         beforeReset.pdf_cache.contentions,
      puppeteer_renders:             beforeReset.pdf_renders.puppeteer,
      snapshot_stats_hit_rate_pct:   beforeReset.snapshot_stats_hit_rate_pct,
      snapshot_monthly_hit_rate_pct: beforeReset.snapshot_monthly_hit_rate_pct,
      snapshot_recomputes:           beforeReset.snapshot.recomputes,
      snapshot_lock_contentions:     beforeReset.snapshot.lock_contentions,
      redis:                         beforeReset.redis,
    },
  }, {
    status: 200,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
