export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getMetrics, getTimingStats } from "@/lib/metrics";

export async function GET() {
  const m = getMetrics();
  const timing = getTimingStats();

  return NextResponse.json({
    // ── Webhooks ────────────────────────────────────────────────
    webhook_total:              m.webhooks.total,
    webhook_success:            m.webhooks.success,
    webhook_errors:             m.webhooks.errors,
    webhook_success_rate_pct:   Number(m.webhook_success_rate.toFixed(2)),
    webhook_last_error:         m.webhooks.last_error,

    // ── Payments ────────────────────────────────────────────────
    payments_created:           m.payments.created,
    payments_success:           m.payments.success,
    payments_failed:            m.payments.failed,
    payments_reconciled:        m.payments.reconciled,

    // ── Auth ────────────────────────────────────────────────────
    auth_login_success:         m.auth.login_success,
    auth_login_failed:          m.auth.login_failed,
    auth_refresh_success:       m.auth.refresh_success,
    auth_refresh_failed:        m.auth.refresh_failed,
    auth_token_reuse_detected:  m.auth.token_reuse_detected,

    // ── PDF Cache ────────────────────────────────────────────────
    receipt_pdf_hits:           m.pdf_cache.receipt_hits,
    receipt_pdf_misses:         m.pdf_cache.receipt_misses,
    receipt_pdf_hit_rate_pct:   m.receipt_pdf_hit_rate_pct,
    invoice_pdf_hits:           m.pdf_cache.invoice_hits,
    invoice_pdf_misses:         m.pdf_cache.invoice_misses,
    invoice_pdf_hit_rate_pct:   m.invoice_pdf_hit_rate_pct,
    pdf_cache_contentions:      m.pdf_cache.contentions,

    // ── PDF Render Volume ────────────────────────────────────────
    puppeteer_renders:          m.pdf_renders.puppeteer,
    invoice_renders:            m.pdf_renders.invoice,

    // ── Snapshot Architecture ────────────────────────────────────
    snapshot_stats_hits:           m.snapshot.stats_hits,
    snapshot_stats_misses:         m.snapshot.stats_misses,
    snapshot_stats_hit_rate_pct:   m.snapshot_stats_hit_rate_pct,
    snapshot_monthly_hits:         m.snapshot.monthly_hits,
    snapshot_monthly_misses:       m.snapshot.monthly_misses,
    snapshot_monthly_hit_rate_pct: m.snapshot_monthly_hit_rate_pct,
    snapshot_recomputes:           m.snapshot.recomputes,
    snapshot_lock_contentions:     m.snapshot.lock_contentions,

    // ── Redis Acceleration ──────────────────────────────────────
    redis_hits:                    m.redis.hit,
    redis_misses:                  m.redis.miss,
    redis_sets:                    m.redis.set,
    redis_deletes:                 m.redis.delete,
    redis_errors:                  m.redis.error,
    redis_fallbacks:               m.redis.fallback,
    redis_rate_limit_blocks:       m.redis.rate_limit_blocked,
    redis_queue_claimed:           m.redis.queue_claimed,
    redis_queue_failed:            m.redis.queue_failed,

    // ── Per-operation Timing (count / avg_ms / max_ms) ───────────
    // Keyed by operation name from timed() calls.
    // Only populated after first execution of each operation.
    // Reset via POST /api/metrics/reset.
    timing,

    // ── Meta ─────────────────────────────────────────────────────
    last_reset:  m.lastReset,
    timestamp:   new Date().toISOString(),
  }, {
    status: 200,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
