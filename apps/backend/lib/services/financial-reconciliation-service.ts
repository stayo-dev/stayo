/**
 * FinancialReconciliationService — Single-Business Rebuild (Phase 6)
 *
 * Detects operational payment integrity violations across the live payment
 * tables: payment_attempts, payments, rent_obligations.
 *
 * The settlement-ledger and payout detectors from the SaaS architecture
 * have been removed. owner_settlement_ledger / settlement_batches are
 * decommissioned. This service now focuses solely on the direct-revenue
 * model: tenant → PhonePe → payments → obligations.
 *
 * Architectural contracts (unchanged from original):
 *
 *  R-1  STRICT READ-ONLY. detectAll() never mutates financial tables.
 *       The only write path is persistIssues(), which upserts into
 *       financial_reconciliation_issues via the fingerprint dedup index.
 *
 *  R-2  NO REPAIR BY RECALCULATION. Detection only; repair is a human
 *       admin decision via the admin reconciliation surface.
 *
 *  R-3  DETERMINISTIC FINGERPRINTS. Re-running produces the same
 *       fingerprint so the partial unique index on fingerprint dedupes.
 *
 *  R-4  ENUM PRESERVATION. The DB CHECK constraint on issue_type uses
 *       the 10-value enum from migration 059. New detector kinds are
 *       mapped onto those values; metadata.subkind provides specificity.
 *
 *  R-5  ADMIN-ONLY. This service is called exclusively from
 *       /api/admin/finance/reconciliation/**.
 */

import { prisma } from "../db";

// ─────────────────────────────────────────────────────────────────────────────
//  Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The 7 operational detectors. Mapped onto the 10-value DB enum via
 * mapToDbIssueType() — no schema migration required.
 */
export const DETECTOR_KIND = {
  DUPLICATE_PAYMENT:          "DUPLICATE_PAYMENT",
  WEBHOOK_MISMATCH:           "WEBHOOK_MISMATCH",
  STALE_PROCESSING:           "STALE_PROCESSING",
  HOSTEL_ISOLATION_DRIFT:     "HOSTEL_ISOLATION_DRIFT",
  OBLIGATION_AMOUNT_MISMATCH: "OBLIGATION_AMOUNT_MISMATCH",
  ORPHAN_ATTEMPT:             "ORPHAN_ATTEMPT",
  DUES_EXCEED_COLLECTED:      "DUES_EXCEED_COLLECTED",
} as const;

export type DetectorKind = typeof DETECTOR_KIND[keyof typeof DETECTOR_KIND];

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface IssueReport {
  kind: DetectorKind;
  severity: Severity;
  fingerprint: string;
  description: string;
  owner_id: string | null;
  hostel_id: string | null;
  payment_id: string | null;
  ledger_entry_id: string | null;
  batch_id: string | null;
  batch_item_id: string | null;
  metadata: Record<string, any>;
}

export interface DetectionSummary {
  detector_kind: DetectorKind;
  count: number;
  ms: number;
  error?: string;
}

export interface ReconciliationReport {
  started_at: Date;
  finished_at: Date;
  total_ms: number;
  issues: IssueReport[];
  summary: DetectionSummary[];
}

// Map detector kinds onto the DB enum values from migration 059.
// metadata.subkind disambiguates within shared DB enum buckets.
function mapToDbIssueType(kind: DetectorKind): string {
  switch (kind) {
    case DETECTOR_KIND.DUPLICATE_PAYMENT:          return "DUPLICATE_SETTLEMENT";
    case DETECTOR_KIND.WEBHOOK_MISMATCH:           return "LEDGER_WITHOUT_PAYMENT";
    case DETECTOR_KIND.STALE_PROCESSING:           return "PAYMENT_WITHOUT_LEDGER";
    case DETECTOR_KIND.HOSTEL_ISOLATION_DRIFT:     return "HOSTEL_ISOLATION_VIOLATION";
    case DETECTOR_KIND.OBLIGATION_AMOUNT_MISMATCH: return "BATCH_AMOUNT_DRIFT";
    case DETECTOR_KIND.ORPHAN_ATTEMPT:             return "NEGATIVE_BALANCE";
    case DETECTOR_KIND.DUES_EXCEED_COLLECTED:      return "SETTLED_EXCEEDS_COLLECTED";
  }
}

function fp(...parts: (string | number | null | undefined)[]): string {
  return parts.map((p) => (p == null ? "_" : String(p))).join("|");
}

// ─────────────────────────────────────────────────────────────────────────────
//  Service
// ─────────────────────────────────────────────────────────────────────────────

export class FinancialReconciliationService {
  /**
   * Run all 7 detectors in parallel. Each is independently bounded by
   * `limit` to keep response time predictable on large datasets.
   */
  async detectAll(options: { limit?: number } = {}): Promise<ReconciliationReport> {
    const limit = Math.min(Math.max(options.limit ?? 500, 1), 5000);
    const started_at = new Date();
    const t0 = Date.now();

    const detectors: Array<{ kind: DetectorKind; run: () => Promise<IssueReport[]> }> = [
      { kind: DETECTOR_KIND.DUPLICATE_PAYMENT,          run: () => this.detectDuplicatePayments(limit) },
      { kind: DETECTOR_KIND.WEBHOOK_MISMATCH,           run: () => this.detectWebhookMismatches(limit) },
      { kind: DETECTOR_KIND.STALE_PROCESSING,           run: () => this.detectStaleProcessing(limit) },
      { kind: DETECTOR_KIND.HOSTEL_ISOLATION_DRIFT,     run: () => this.detectHostelIsolationDrift(limit) },
      { kind: DETECTOR_KIND.OBLIGATION_AMOUNT_MISMATCH, run: () => this.detectObligationAmountMismatch(limit) },
      { kind: DETECTOR_KIND.ORPHAN_ATTEMPT,             run: () => this.detectOrphanAttempts(limit) },
      { kind: DETECTOR_KIND.DUES_EXCEED_COLLECTED,      run: () => this.detectDuesExceedCollected(limit) },
    ];

    const results = await Promise.all(detectors.map(async (d) => {
      const t = Date.now();
      try {
        const rows = await d.run();
        return { kind: d.kind, rows, ms: Date.now() - t, error: undefined as string | undefined };
      } catch (err: any) {
        return { kind: d.kind, rows: [] as IssueReport[], ms: Date.now() - t, error: String(err?.message ?? err) };
      }
    }));

    const issues = results.flatMap((r) => r.rows);
    const summary: DetectionSummary[] = results.map((r) => ({
      detector_kind: r.kind, count: r.rows.length, ms: r.ms, error: r.error,
    }));

    return { started_at, finished_at: new Date(), total_ms: Date.now() - t0, issues, summary };
  }

  /**
   * Persist a detection report into financial_reconciliation_issues.
   * Insertion is deduped per fingerprint via the partial unique index on
   * (fingerprint) WHERE status IN ('OPEN','INVESTIGATING').
   */
  async persistIssues(report: ReconciliationReport, opts: { actorId?: string } = {}) {
    let inserted = 0;
    let skipped = 0;

    for (const it of report.issues) {
      try {
        await prisma.financial_reconciliation_issues.create({
          data: {
            issue_type:      mapToDbIssueType(it.kind),
            severity:        it.severity,
            status:          "OPEN",
            owner_id:        it.owner_id,
            hostel_id:       it.hostel_id,
            payment_id:      it.payment_id,
            ledger_entry_id: it.ledger_entry_id,
            batch_id:        it.batch_id,
            batch_item_id:   it.batch_item_id,
            fingerprint:     it.fingerprint,
            description:     it.description,
            metadata:        { ...it.metadata, detector_kind: it.kind, persisted_by: opts.actorId ?? null },
          },
        });
        inserted++;
      } catch (err: any) {
        if (String(err?.code) === "P2002" || /udx_fri_fingerprint_open/.test(String(err?.message))) {
          skipped++;
          continue;
        }
        throw err;
      }
    }
    return { inserted, skipped };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  DETECTORS
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 1. DUPLICATE_PAYMENT — two or more `payments` rows share the same
   *    `payment_attempt_id`. The finalization path must write exactly one
   *    payment row per attempt; any duplication means idempotency was
   *    bypassed and money may have been double-recorded.
   */
  async detectDuplicatePayments(limit = 500): Promise<IssueReport[]> {
    const rows: Array<{
      payment_attempt_id: string;
      payment_count: number;
      payment_ids: string[];
      total_collected: string;
      hostel_id: string | null;
      owner_id: string | null;
    }> = await prisma.$queryRaw`
      SELECT
        payment_attempt_id,
        COUNT(*)::int                        AS payment_count,
        array_agg(id::text)                  AS payment_ids,
        SUM(amount_paid)::text               AS total_collected,
        MAX(hostel_id::text)                 AS hostel_id,
        MAX(owner_id::text)                  AS owner_id
      FROM payments
      WHERE payment_attempt_id IS NOT NULL
      GROUP BY payment_attempt_id
      HAVING COUNT(*) > 1
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      kind: DETECTOR_KIND.DUPLICATE_PAYMENT,
      severity: "CRITICAL" as const,
      fingerprint: fp("DUPLICATE_PAYMENT", r.payment_attempt_id),
      description: `Attempt ${r.payment_attempt_id} produced ${r.payment_count} payment rows (expected 1). Total recorded: ₹${r.total_collected}.`,
      owner_id: r.owner_id,
      hostel_id: r.hostel_id,
      payment_id: r.payment_ids[0] ?? null,
      ledger_entry_id: null,
      batch_id: null,
      batch_item_id: null,
      metadata: { subkind: "ATTEMPT_DOUBLE_PAYMENT", payment_count: r.payment_count, payment_ids: r.payment_ids, total_collected: r.total_collected },
    }));
  }

  /**
   * 2. WEBHOOK_MISMATCH — payment_attempts stuck in PENDING_VERIFICATION
   *    for > 1 hour. PENDING_VERIFICATION means PhonePe's webhook arrived
   *    and claimed the attempt, but finalization (settle_attempt) never ran
   *    or crashed. The reconcile-payments cron should clear these; any
   *    surviving after an hour indicates a stuck finalization path.
   */
  async detectWebhookMismatches(limit = 500): Promise<IssueReport[]> {
    const rows: Array<{
      attempt_id: string;
      merchant_txn_id: string;
      hostel_id: string | null;
      owner_id: string;
      amount: string;
      created_at: Date;
      payment_domain: string | null;
    }> = await prisma.$queryRaw`
      SELECT
        id              AS attempt_id,
        merchant_txn_id,
        hostel_id::text AS hostel_id,
        owner_id::text  AS owner_id,
        amount::text    AS amount,
        created_at,
        payment_domain
      FROM payment_attempts
      WHERE status = 'PENDING_VERIFICATION'
        AND created_at < NOW() - INTERVAL '1 hour'
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      kind: DETECTOR_KIND.WEBHOOK_MISMATCH,
      severity: "HIGH" as const,
      fingerprint: fp("WEBHOOK_MISMATCH", r.attempt_id),
      description: `Attempt ${r.attempt_id} (${r.merchant_txn_id}) has been in PENDING_VERIFICATION since ${r.created_at.toISOString()} — webhook received but finalization never completed.`,
      owner_id: r.owner_id,
      hostel_id: r.hostel_id,
      payment_id: null,
      ledger_entry_id: null,
      batch_id: null,
      batch_item_id: null,
      metadata: { subkind: "STUCK_PENDING_VERIFICATION", merchant_txn_id: r.merchant_txn_id, amount: r.amount, created_at: r.created_at, payment_domain: r.payment_domain },
    }));
  }

  /**
   * 3. STALE_PROCESSING — payment_attempts stuck in PROCESSING for > 30 min.
   *    PROCESSING is the exclusive finalization lock. If it persists beyond
   *    30 minutes the finalization goroutine died mid-flight (crash, OOM,
   *    or forced deploy). These cannot self-recover and require manual admin
   *    intervention via the verify/confirm endpoints.
   */
  async detectStaleProcessing(limit = 500): Promise<IssueReport[]> {
    const rows: Array<{
      attempt_id: string;
      merchant_txn_id: string;
      hostel_id: string | null;
      owner_id: string;
      amount: string;
      locked_since: Date;
      payment_domain: string | null;
    }> = await prisma.$queryRaw`
      SELECT
        id                                          AS attempt_id,
        merchant_txn_id,
        hostel_id::text                             AS hostel_id,
        owner_id::text                              AS owner_id,
        amount::text                                AS amount,
        COALESCE(updated_at, created_at)            AS locked_since,
        payment_domain
      FROM payment_attempts
      WHERE status = 'PROCESSING'
        AND COALESCE(updated_at, created_at) < NOW() - INTERVAL '30 minutes'
      ORDER BY COALESCE(updated_at, created_at) ASC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      kind: DETECTOR_KIND.STALE_PROCESSING,
      severity: "CRITICAL" as const,
      fingerprint: fp("STALE_PROCESSING", r.attempt_id),
      description: `Attempt ${r.attempt_id} (${r.merchant_txn_id}) has been PROCESSING since ${r.locked_since.toISOString()} — finalization goroutine likely died.`,
      owner_id: r.owner_id,
      hostel_id: r.hostel_id,
      payment_id: null,
      ledger_entry_id: null,
      batch_id: null,
      batch_item_id: null,
      metadata: { subkind: "STUCK_PROCESSING", merchant_txn_id: r.merchant_txn_id, amount: r.amount, locked_since: r.locked_since, payment_domain: r.payment_domain },
    }));
  }

  /**
   * 4. HOSTEL_ISOLATION_DRIFT — a payments row whose hostel_id differs
   *    from its linked rent_obligation's hostel_id. Each hostel's books
   *    must be independently reconcilable; cross-hostel attribution is an
   *    accounting violation even within the same organization.
   */
  async detectHostelIsolationDrift(limit = 500): Promise<IssueReport[]> {
    const rows: Array<{
      payment_id: string;
      payment_hostel: string;
      obligation_hostel: string;
      obligation_id: string;
      owner_id: string | null;
      amount_paid: string;
    }> = await prisma.$queryRaw`
      SELECT
        p.id            AS payment_id,
        p.hostel_id     AS payment_hostel,
        o.hostel_id     AS obligation_hostel,
        o.id            AS obligation_id,
        p.owner_id::text AS owner_id,
        p.amount_paid::text AS amount_paid
      FROM payments p
      JOIN rent_obligations o ON o.id = p.obligation_id
      WHERE p.hostel_id <> o.hostel_id
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      kind: DETECTOR_KIND.HOSTEL_ISOLATION_DRIFT,
      severity: "HIGH" as const,
      fingerprint: fp("HOSTEL_ISOLATION_DRIFT", r.payment_id),
      description: `Payment ${r.payment_id} is attributed to hostel ${r.payment_hostel} but its obligation ${r.obligation_id} belongs to hostel ${r.obligation_hostel}.`,
      owner_id: r.owner_id,
      hostel_id: r.payment_hostel,
      payment_id: r.payment_id,
      ledger_entry_id: null,
      batch_id: null,
      batch_item_id: null,
      metadata: { subkind: "PAYMENT_HOSTEL_MISMATCH", payment_hostel: r.payment_hostel, obligation_hostel: r.obligation_hostel, obligation_id: r.obligation_id, amount_paid: r.amount_paid },
    }));
  }

  /**
   * 5. OBLIGATION_AMOUNT_MISMATCH — a PAID obligation where the sum of
   *    all linked payment rows differs from the obligation amount by more
   *    than ₹0.005. This catches both underpayment marked as PAID
   *    (bug in status transition) and overpayment (double-collection
   *    where idempotency_key protected individual records but total
   *    exceeded the obligation).
   */
  async detectObligationAmountMismatch(limit = 500): Promise<IssueReport[]> {
    const rows: Array<{
      obligation_id: string;
      tenant_id: string;
      hostel_id: string;
      owner_id: string;
      obligated: string;
      collected: string;
      drift: string;
    }> = await prisma.$queryRaw`
      SELECT
        o.id                            AS obligation_id,
        o.tenant_id::text               AS tenant_id,
        o.hostel_id::text               AS hostel_id,
        o.owner_id::text                AS owner_id,
        o.amount::text                  AS obligated,
        SUM(p.amount_paid)::text        AS collected,
        (SUM(p.amount_paid) - o.amount)::text AS drift
      FROM rent_obligations o
      JOIN payments p ON p.obligation_id = o.id
      WHERE o.status = 'PAID'
      GROUP BY o.id, o.tenant_id, o.hostel_id, o.owner_id, o.amount
      HAVING ABS(SUM(p.amount_paid) - o.amount) > 0.005
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      kind: DETECTOR_KIND.OBLIGATION_AMOUNT_MISMATCH,
      severity: Number(r.drift) > 0 ? "HIGH" as const : "CRITICAL" as const,
      fingerprint: fp("OBLIGATION_AMOUNT_MISMATCH", r.obligation_id),
      description: Number(r.drift) > 0
        ? `Obligation ${r.obligation_id} is PAID but collected ₹${r.collected} exceeds obligated ₹${r.obligated} by ₹${r.drift}.`
        : `Obligation ${r.obligation_id} is marked PAID but only ₹${r.collected} collected of ₹${r.obligated} (shortfall ₹${r.drift}).`,
      owner_id: r.owner_id,
      hostel_id: r.hostel_id,
      payment_id: null,
      ledger_entry_id: null,
      batch_id: null,
      batch_item_id: null,
      metadata: { subkind: Number(r.drift) > 0 ? "OVERPAID" : "UNDERPAID_MARKED_PAID", obligated: r.obligated, collected: r.collected, drift: r.drift },
    }));
  }

  /**
   * 6. ORPHAN_ATTEMPT — a SUCCESS payment_attempt for RENT_COLLECTION
   *    that has no linked payments row. Money came in from PhonePe but
   *    was never recorded in the canonical payments table. This is a
   *    critical accounting gap — revenue is unrecorded.
   */
  async detectOrphanAttempts(limit = 500): Promise<IssueReport[]> {
    const rows: Array<{
      attempt_id: string;
      merchant_txn_id: string;
      hostel_id: string | null;
      owner_id: string;
      amount: string;
      confirmed_at: Date | null;
    }> = await prisma.$queryRaw`
      SELECT
        a.id                AS attempt_id,
        a.merchant_txn_id,
        a.hostel_id::text   AS hostel_id,
        a.owner_id::text    AS owner_id,
        a.amount::text      AS amount,
        a.confirmed_at
      FROM payment_attempts a
      WHERE a.status = 'SUCCESS'
        AND a.payment_domain = 'RENT_COLLECTION'
        AND NOT EXISTS (
          SELECT 1 FROM payments p WHERE p.payment_attempt_id = a.id
        )
      ORDER BY a.confirmed_at DESC NULLS LAST
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      kind: DETECTOR_KIND.ORPHAN_ATTEMPT,
      severity: "CRITICAL" as const,
      fingerprint: fp("ORPHAN_ATTEMPT", r.attempt_id),
      description: `Attempt ${r.attempt_id} (${r.merchant_txn_id}) is SUCCESS with no payments row — ₹${r.amount} may be unrecorded revenue.`,
      owner_id: r.owner_id,
      hostel_id: r.hostel_id,
      payment_id: null,
      ledger_entry_id: null,
      batch_id: null,
      batch_item_id: null,
      metadata: { subkind: "SUCCESS_WITHOUT_PAYMENT_ROW", merchant_txn_id: r.merchant_txn_id, amount: r.amount, confirmed_at: r.confirmed_at },
    }));
  }

  /**
   * 7. DUES_EXCEED_COLLECTED — per hostel, the cumulative amount_paid
   *    across all payments exceeds the sum of all non-WAIVED obligations.
   *    This should be impossible in a correct system (you cannot collect
   *    more than was owed) and indicates either data corruption or
   *    double-collection that bypassed idempotency at the hostel level.
   */
  async detectDuesExceedCollected(limit = 500): Promise<IssueReport[]> {
    const rows: Array<{
      hostel_id: string;
      collected: string;
      obligated: string;
      excess: string;
    }> = await prisma.$queryRaw`
      WITH collected AS (
        SELECT hostel_id, SUM(amount_paid) AS total
        FROM payments
        GROUP BY hostel_id
      ),
      obligated AS (
        SELECT hostel_id, SUM(amount) AS total
        FROM rent_obligations
        WHERE status IN ('PAID', 'PARTIAL', 'PENDING')
        GROUP BY hostel_id
      )
      SELECT
        c.hostel_id::text              AS hostel_id,
        c.total::text                  AS collected,
        COALESCE(o.total, 0)::text     AS obligated,
        (c.total - COALESCE(o.total, 0))::text AS excess
      FROM collected c
      LEFT JOIN obligated o USING (hostel_id)
      WHERE c.total > COALESCE(o.total, 0) + 0.005
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      kind: DETECTOR_KIND.DUES_EXCEED_COLLECTED,
      severity: "CRITICAL" as const,
      fingerprint: fp("DUES_EXCEED_COLLECTED", r.hostel_id),
      description: `Hostel ${r.hostel_id}: collected ₹${r.collected} exceeds non-waived obligations ₹${r.obligated} by ₹${r.excess}.`,
      owner_id: null,
      hostel_id: r.hostel_id,
      payment_id: null,
      ledger_entry_id: null,
      batch_id: null,
      batch_item_id: null,
      metadata: { subkind: "HOSTEL_OVERCOLLECTION", collected: r.collected, obligated: r.obligated, excess: r.excess },
    }));
  }
}

export const financialReconciliationService = new FinancialReconciliationService();
