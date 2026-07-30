/**
 * In-memory metrics store for webhook, payment, and observability monitoring.
 * Note: In a multi-instance deployment (e.g., Vercel), counters are per-instance.
 * Values are best-effort for operational visibility, not billing-critical.
 */

import { getRedisMetrics, resetRedisMetrics } from "./redis/metrics";

// ── Per-operation timing registry ──────────────────────────────────────────────
interface OperationStats {
  count:    number;
  total_ms: number;
  max_ms:   number;
}

const timingRegistry = new Map<string, OperationStats>();

export function recordTiming(operation: string, duration_ms: number) {
  const existing = timingRegistry.get(operation);
  if (existing) {
    existing.count    += 1;
    existing.total_ms += duration_ms;
    if (duration_ms > existing.max_ms) existing.max_ms = duration_ms;
  } else {
    timingRegistry.set(operation, { count: 1, total_ms: duration_ms, max_ms: duration_ms });
  }
}

export function getTimingStats(): Record<string, { count: number; avg_ms: number; max_ms: number; total_ms: number }> {
  const result: Record<string, { count: number; avg_ms: number; max_ms: number; total_ms: number }> = {};
  Array.from(timingRegistry.entries()).forEach(([op, s]) => {
    result[op] = {
      count:    s.count,
      avg_ms:   s.count > 0 ? Math.round(s.total_ms / s.count) : 0,
      max_ms:   s.max_ms,
      total_ms: s.total_ms,
    };
  });
  return result;
}

function resetTimingStats() {
  timingRegistry.clear();
}
const metrics = {
  webhooks: {
    total: 0,
    success: 0,
    errors: 0,
    last_error: null as string | null,
  },
  payments: {
    created: 0,
    success: 0,
    failed: 0,
    reconciled: 0,
  },
  auth: {
    login_success: 0,
    login_failed: 0,
    refresh_success: 0,
    refresh_failed: 0,
    token_reuse_detected: 0,
  },
  otp: {
    requests_total: 0,
    verifications_total: 0,
    verification_failures: 0,
    rate_limit_hits: 0,
    send_failures: 0,
    expired_total: 0,
    delivery_status_counts: {} as Record<string, number>,
  },
  // ── PDF Cache observability ────────────────────────────────────────────────
  pdf_cache: {
    receipt_hits:    0,  // Puppeteer bypassed — served from ImageKit cache
    receipt_misses:  0,  // Puppeteer ran — PDF was not cached or version changed
    invoice_hits:    0,  // pdf-lib bypassed — served from ImageKit cache
    invoice_misses:  0,  // pdf-lib ran — PDF was not cached or version changed
    contentions:     0,  // Concurrent render attempts
  },
  // ── Snapshot observability ─────────────────────────────────────────────────
  snapshot: {
    stats_hits:        0,  // getOwnerStats served from fresh snapshot row
    stats_misses:      0,  // getOwnerStats triggered recompute
    monthly_hits:      0,  // getMonthlyStats served from fresh snapshot row
    monthly_misses:    0,  // getMonthlyStats triggered recompute
    recomputes:        0,  // Total recompute executions (stats + monthly)
    lock_contentions:  0,  // Recompute skipped because lock was held
  },
  // ── Operational integrity observability ───────────────────────────────────
  integrity: {
    invariant_failures: 0,
    critical_failures: 0,
    high_failures: 0,
    medium_failures: 0,
    low_failures: 0,
    dual_read_mismatches: 0,
    orphan_records: 0,
    rollup_mismatches: 0,
  },
  // ── PDF Render volume ──────────────────────────────────────────────────────
  pdf_renders: {
    puppeteer: 0,  // Actual Puppeteer renders (costly CPU path)
    invoice:   0,  // Actual pdf-lib renders
  },
  lastReset: new Date().toISOString(),
};

// ── Webhooks ────────────────────────────────────────────────────────────────

export function incrementWebhook(success: boolean) {
  metrics.webhooks.total++;
  if (success) {
    metrics.webhooks.success++;
  } else {
    metrics.webhooks.errors++;
    metrics.webhooks.last_error = new Date().toISOString();
  }
}

// ── Payments ────────────────────────────────────────────────────────────────

export function incrementPayment(type: "created" | "success" | "failed" | "reconciled") {
  metrics.payments[type]++;
}

// ── Auth ────────────────────────────────────────────────────────────────────

export function incrementAuth(type: "login_success" | "login_failed" | "refresh_success" | "refresh_failed" | "token_reuse_detected") {
  metrics.auth[type]++;
}

// ── OTP ─────────────────────────────────────────────────────────────────────

export function incrementOtpMetric(
  type:
    | "requests_total"
    | "verifications_total"
    | "verification_failures"
    | "rate_limit_hits"
    | "send_failures"
    | "expired_total",
) {
  metrics.otp[type]++;
}

export function incrementOtpDeliveryStatus(status: string) {
  const normalized = String(status || "UNKNOWN").toUpperCase();
  metrics.otp.delivery_status_counts[normalized] =
    (metrics.otp.delivery_status_counts[normalized] || 0) + 1;
}

// ── PDF Cache ────────────────────────────────────────────────────────────────

export function incrementPdfCache(type: "receipt_hit" | "receipt_miss" | "invoice_hit" | "invoice_miss" | "contention") {
  if (type === "contention")    { metrics.pdf_cache.contentions++; return; }
  if (type === "receipt_hit")   { metrics.pdf_cache.receipt_hits++;   metrics.pdf_renders.puppeteer += 0; return; }
  if (type === "receipt_miss")  { metrics.pdf_cache.receipt_misses++; metrics.pdf_renders.puppeteer++;    return; }
  if (type === "invoice_hit")   { metrics.pdf_cache.invoice_hits++;                                       return; }
  if (type === "invoice_miss")  { metrics.pdf_cache.invoice_misses++; metrics.pdf_renders.invoice++;      return; }
}

// ── Snapshot ────────────────────────────────────────────────────────────────

export function incrementSnapshot(
  type: "stats_hit" | "stats_miss" | "monthly_hit" | "monthly_miss" | "recompute" | "lock_contention"
) {
  if (type === "stats_hit")        { metrics.snapshot.stats_hits++;        return; }
  if (type === "stats_miss")       { metrics.snapshot.stats_misses++;      metrics.snapshot.recomputes++; return; }
  if (type === "monthly_hit")      { metrics.snapshot.monthly_hits++;      return; }
  if (type === "monthly_miss")     { metrics.snapshot.monthly_misses++;    metrics.snapshot.recomputes++; return; }
  if (type === "recompute")        { metrics.snapshot.recomputes++;        return; }
  if (type === "lock_contention")  { metrics.snapshot.lock_contentions++;  return; }
}

// ── Operational Integrity ───────────────────────────────────────────────────

export function incrementIntegrityMetric(
  type: "invariant_failure" | "dual_read_mismatch" | "orphan_record" | "rollup_mismatch",
  severity?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
) {
  if (type === "invariant_failure") {
    metrics.integrity.invariant_failures++;
    if (severity === "CRITICAL") metrics.integrity.critical_failures++;
    if (severity === "HIGH") metrics.integrity.high_failures++;
    if (severity === "MEDIUM") metrics.integrity.medium_failures++;
    if (severity === "LOW") metrics.integrity.low_failures++;
    return;
  }
  if (type === "dual_read_mismatch") { metrics.integrity.dual_read_mismatches++; return; }
  if (type === "orphan_record")      { metrics.integrity.orphan_records++;       return; }
  if (type === "rollup_mismatch")    { metrics.integrity.rollup_mismatches++;    return; }
}

// ── Read ─────────────────────────────────────────────────────────────────────

export function getMetrics() {
  const totalReceiptRequests = metrics.pdf_cache.receipt_hits + metrics.pdf_cache.receipt_misses;
  const totalInvoiceRequests = metrics.pdf_cache.invoice_hits + metrics.pdf_cache.invoice_misses;
  const totalSnapshotStats   = metrics.snapshot.stats_hits   + metrics.snapshot.stats_misses;
  const totalSnapshotMonthly = metrics.snapshot.monthly_hits + metrics.snapshot.monthly_misses;

  return {
    ...metrics,
    redis: getRedisMetrics(),
    webhook_success_rate: metrics.webhooks.total > 0
      ? (metrics.webhooks.success / metrics.webhooks.total) * 100
      : 100,
    // Derived hit-rate percentages
    receipt_pdf_hit_rate_pct: totalReceiptRequests > 0
      ? Math.round((metrics.pdf_cache.receipt_hits / totalReceiptRequests) * 100)
      : null,
    invoice_pdf_hit_rate_pct: totalInvoiceRequests > 0
      ? Math.round((metrics.pdf_cache.invoice_hits / totalInvoiceRequests) * 100)
      : null,
    snapshot_stats_hit_rate_pct: totalSnapshotStats > 0
      ? Math.round((metrics.snapshot.stats_hits / totalSnapshotStats) * 100)
      : null,
    snapshot_monthly_hit_rate_pct: totalSnapshotMonthly > 0
      ? Math.round((metrics.snapshot.monthly_hits / totalSnapshotMonthly) * 100)
      : null,
  };
}

// ── Reset ─────────────────────────────────────────────────────────────────────

export function resetMetrics() {
  metrics.webhooks.total = 0;
  metrics.webhooks.success = 0;
  metrics.webhooks.errors = 0;
  metrics.webhooks.last_error = null;
  metrics.payments.created = 0;
  metrics.payments.success = 0;
  metrics.payments.failed = 0;
  metrics.payments.reconciled = 0;
  metrics.auth.login_success = 0;
  metrics.auth.login_failed = 0;
  metrics.auth.refresh_success = 0;
  metrics.auth.refresh_failed = 0;
  metrics.auth.token_reuse_detected = 0;
  metrics.otp.requests_total = 0;
  metrics.otp.verifications_total = 0;
  metrics.otp.verification_failures = 0;
  metrics.otp.rate_limit_hits = 0;
  metrics.otp.send_failures = 0;
  metrics.otp.expired_total = 0;
  metrics.otp.delivery_status_counts = {};
  metrics.pdf_cache.receipt_hits = 0;
  metrics.pdf_cache.receipt_misses = 0;
  metrics.pdf_cache.invoice_hits = 0;
  metrics.pdf_cache.invoice_misses = 0;
  metrics.pdf_cache.contentions = 0;
  metrics.snapshot.stats_hits = 0;
  metrics.snapshot.stats_misses = 0;
  metrics.snapshot.monthly_hits = 0;
  metrics.snapshot.monthly_misses = 0;
  metrics.snapshot.recomputes = 0;
  metrics.snapshot.lock_contentions = 0;
  metrics.integrity.invariant_failures = 0;
  metrics.integrity.critical_failures = 0;
  metrics.integrity.high_failures = 0;
  metrics.integrity.medium_failures = 0;
  metrics.integrity.low_failures = 0;
  metrics.integrity.dual_read_mismatches = 0;
  metrics.integrity.orphan_records = 0;
  metrics.integrity.rollup_mismatches = 0;
  metrics.pdf_renders.puppeteer = 0;
  metrics.pdf_renders.invoice = 0;
  metrics.lastReset = new Date().toISOString();
  resetRedisMetrics();
  resetTimingStats();
}
