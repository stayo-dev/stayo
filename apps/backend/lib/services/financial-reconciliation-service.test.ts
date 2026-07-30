/**
 * FinancialReconciliationService — Operational Regression Suite (Phase 6)
 *
 * Run:
 *   DOTENV_CONFIG_PATH=../../.env node -r dotenv/config ./node_modules/.bin/tsx \
 *     lib/services/financial-reconciliation-service.test.ts
 *
 * No real DB. Prisma's $queryRaw is replaced with a SQL-substring router
 * that returns canned rows. Each test pins a specific corruption pattern
 * and asserts kind, severity, fingerprint, and reproduction metadata.
 *
 * Coverage:
 *   - Duplicate attempt payment  → DUPLICATE_PAYMENT (CRITICAL)
 *   - Webhook stuck              → WEBHOOK_MISMATCH (HIGH)
 *   - Processing stuck           → STALE_PROCESSING (CRITICAL)
 *   - Hostel cross-attribution   → HOSTEL_ISOLATION_DRIFT (HIGH)
 *   - Overpaid obligation        → OBLIGATION_AMOUNT_MISMATCH (HIGH, OVERPAID)
 *   - Underpaid marked PAID      → OBLIGATION_AMOUNT_MISMATCH (CRITICAL, UNDERPAID)
 *   - SUCCESS with no payment    → ORPHAN_ATTEMPT (CRITICAL)
 *   - Hostel overcollection      → DUES_EXCEED_COLLECTED (CRITICAL)
 *   - Clean scan → 0 issues      → detectAll returns empty issues
 *   - Persist dedup              → P2002 collision counts as skipped, not error
 */

import {
  FinancialReconciliationService,
  DETECTOR_KIND,
  type IssueReport,
} from "./financial-reconciliation-service";

// ── harness ────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { console.log(`  OK ${name}`); passed++; }
  else {
    const m = `  FAIL ${name}${detail ? ` — ${detail}` : ""}`;
    console.error(m); failures.push(m); failed++;
  }
}
function assertEq<T>(actual: T, expected: T, name: string) {
  assert(actual === expected, name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── canonical UUIDs ────────────────────────────────────────────────────────
const O_A  = "11111111-1111-1111-1111-111111111111";
const H_1  = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const H_2  = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PAY1 = "ffffffff-ffff-ffff-ffff-ffffffff0001";
const PAY2 = "ffffffff-ffff-ffff-ffff-ffffffff0002";
const ATT1 = "aaaaaaaa-0000-0000-0000-000000000001";
const OBL1 = "bbbbbbbb-0000-0000-0000-000000000001";

// ── prisma stub plumbing ───────────────────────────────────────────────────
type Router = Array<{ match: RegExp; rows: any[] | (() => any[]) }>;

async function installPrismaRouter(router: Router) {
  const dbModule: any = await import("../db");
  dbModule.prisma.$queryRaw = (strings: TemplateStringsArray | string[], ..._params: any[]) => {
    const arr = Array.isArray(strings) ? (strings as string[]) : [String(strings)];
    const sqlText = arr.join(" ");
    for (const r of router) {
      if (r.match.test(sqlText)) {
        return Promise.resolve(typeof r.rows === "function" ? r.rows() : r.rows);
      }
    }
    return Promise.resolve([]);
  };
  return dbModule;
}

// ── individual detector tests ──────────────────────────────────────────────

async function test_duplicate_payment_same_attempt_two_rows() {
  await installPrismaRouter([{
    match: /FROM payments\s+WHERE payment_attempt_id IS NOT NULL/,
    rows: [{
      payment_attempt_id: ATT1,
      payment_count: 2,
      payment_ids: [PAY1, PAY2],
      total_collected: "1000.00",
      hostel_id: H_1,
      owner_id: O_A,
    }],
  }]);
  const svc = new FinancialReconciliationService();
  const out = await svc.detectDuplicatePayments();
  assertEq(out.length, 1, "dup_payment: 1 issue");
  assertEq(out[0].kind, DETECTOR_KIND.DUPLICATE_PAYMENT, "dup_payment: kind");
  assertEq(out[0].severity, "CRITICAL", "dup_payment: severity CRITICAL");
  assertEq(out[0].fingerprint, `DUPLICATE_PAYMENT|${ATT1}`, "dup_payment: fingerprint by attempt_id");
  assertEq(out[0].metadata.payment_count, 2, "dup_payment: payment_count in metadata");
  assertEq(out[0].metadata.total_collected, "1000.00", "dup_payment: total_collected in metadata");
  assertEq(out[0].hostel_id, H_1, "dup_payment: hostel_id propagated");
}

async function test_webhook_mismatch_stuck_pending_verification() {
  const stuckAt = new Date(Date.now() - 90 * 60 * 1000); // 90 min ago
  await installPrismaRouter([{
    match: /status = 'PENDING_VERIFICATION'/,
    rows: [{
      attempt_id: ATT1,
      merchant_txn_id: "TXN_STUCK",
      hostel_id: H_1,
      owner_id: O_A,
      amount: "750.00",
      created_at: stuckAt,
      payment_domain: "RENT_COLLECTION",
    }],
  }]);
  const svc = new FinancialReconciliationService();
  const out = await svc.detectWebhookMismatches();
  assertEq(out.length, 1, "webhook_mismatch: 1 issue");
  assertEq(out[0].kind, DETECTOR_KIND.WEBHOOK_MISMATCH, "webhook_mismatch: kind");
  assertEq(out[0].severity, "HIGH", "webhook_mismatch: severity HIGH");
  assertEq(out[0].fingerprint, `WEBHOOK_MISMATCH|${ATT1}`, "webhook_mismatch: fingerprint by attempt_id");
  assertEq(out[0].metadata.merchant_txn_id, "TXN_STUCK", "webhook_mismatch: merchant_txn_id in metadata");
  assertEq(out[0].metadata.payment_domain, "RENT_COLLECTION", "webhook_mismatch: payment_domain in metadata");
}

async function test_stale_processing_crashed_finalization() {
  const lockedAt = new Date(Date.now() - 45 * 60 * 1000); // 45 min ago
  await installPrismaRouter([{
    match: /status = 'PROCESSING'\s+AND COALESCE\(updated_at/,
    rows: [{
      attempt_id: ATT1,
      merchant_txn_id: "TXN_LOCKED",
      hostel_id: H_1,
      owner_id: O_A,
      amount: "1200.00",
      locked_since: lockedAt,
      payment_domain: "RENT_COLLECTION",
    }],
  }]);
  const svc = new FinancialReconciliationService();
  const out = await svc.detectStaleProcessing();
  assertEq(out.length, 1, "stale_processing: 1 issue");
  assertEq(out[0].kind, DETECTOR_KIND.STALE_PROCESSING, "stale_processing: kind");
  assertEq(out[0].severity, "CRITICAL", "stale_processing: severity CRITICAL");
  assertEq(out[0].fingerprint, `STALE_PROCESSING|${ATT1}`, "stale_processing: fingerprint by attempt_id");
  assertEq(out[0].metadata.amount, "1200.00", "stale_processing: amount in metadata");
}

async function test_hostel_isolation_drift_cross_attribution() {
  await installPrismaRouter([{
    match: /JOIN rent_obligations o ON o\.id = p\.obligation_id\s+WHERE p\.hostel_id <> o\.hostel_id/,
    rows: [{
      payment_id: PAY1,
      payment_hostel: H_1,
      obligation_hostel: H_2,
      obligation_id: OBL1,
      owner_id: O_A,
      amount_paid: "500.00",
    }],
  }]);
  const svc = new FinancialReconciliationService();
  const out = await svc.detectHostelIsolationDrift();
  assertEq(out.length, 1, "hostel_drift: 1 issue");
  assertEq(out[0].kind, DETECTOR_KIND.HOSTEL_ISOLATION_DRIFT, "hostel_drift: kind");
  assertEq(out[0].severity, "HIGH", "hostel_drift: severity HIGH");
  assertEq(out[0].fingerprint, `HOSTEL_ISOLATION_DRIFT|${PAY1}`, "hostel_drift: fingerprint by payment_id");
  assertEq(out[0].metadata.payment_hostel, H_1, "hostel_drift: payment_hostel in metadata");
  assertEq(out[0].metadata.obligation_hostel, H_2, "hostel_drift: obligation_hostel in metadata");
}

async function test_obligation_amount_mismatch_overpaid() {
  await installPrismaRouter([{
    match: /FROM rent_obligations o\s+JOIN payments p ON p\.obligation_id = o\.id/,
    rows: [{
      obligation_id: OBL1,
      tenant_id: "tttt-0001",
      hostel_id: H_1,
      owner_id: O_A,
      obligated: "1000.00",
      collected: "1200.00",
      drift: "200.00",   // positive = overpaid
    }],
  }]);
  const svc = new FinancialReconciliationService();
  const out = await svc.detectObligationAmountMismatch();
  assertEq(out.length, 1, "amount_mismatch_over: 1 issue");
  assertEq(out[0].kind, DETECTOR_KIND.OBLIGATION_AMOUNT_MISMATCH, "amount_mismatch_over: kind");
  assertEq(out[0].severity, "HIGH", "amount_mismatch_over: severity HIGH for overpaid");
  assertEq(out[0].metadata.subkind, "OVERPAID", "amount_mismatch_over: subkind OVERPAID");
  assertEq(out[0].fingerprint, `OBLIGATION_AMOUNT_MISMATCH|${OBL1}`, "amount_mismatch_over: fingerprint by obligation_id");
}

async function test_obligation_amount_mismatch_underpaid_marked_paid() {
  await installPrismaRouter([{
    match: /FROM rent_obligations o\s+JOIN payments p ON p\.obligation_id = o\.id/,
    rows: [{
      obligation_id: OBL1,
      tenant_id: "tttt-0001",
      hostel_id: H_1,
      owner_id: O_A,
      obligated: "1000.00",
      collected: "800.00",
      drift: "-200.00",  // negative = underpaid
    }],
  }]);
  const svc = new FinancialReconciliationService();
  const out = await svc.detectObligationAmountMismatch();
  assertEq(out.length, 1, "amount_mismatch_under: 1 issue");
  assertEq(out[0].severity, "CRITICAL", "amount_mismatch_under: severity CRITICAL for underpaid-marked-paid");
  assertEq(out[0].metadata.subkind, "UNDERPAID_MARKED_PAID", "amount_mismatch_under: subkind UNDERPAID_MARKED_PAID");
}

async function test_orphan_attempt_success_without_payment_row() {
  await installPrismaRouter([{
    match: /WHERE a\.status = 'SUCCESS'\s+AND a\.payment_domain = 'RENT_COLLECTION'/,
    rows: [{
      attempt_id: ATT1,
      merchant_txn_id: "TXN_ORPHAN",
      hostel_id: H_1,
      owner_id: O_A,
      amount: "900.00",
      confirmed_at: new Date(Date.now() - 3600000),
    }],
  }]);
  const svc = new FinancialReconciliationService();
  const out = await svc.detectOrphanAttempts();
  assertEq(out.length, 1, "orphan_attempt: 1 issue");
  assertEq(out[0].kind, DETECTOR_KIND.ORPHAN_ATTEMPT, "orphan_attempt: kind");
  assertEq(out[0].severity, "CRITICAL", "orphan_attempt: severity CRITICAL");
  assertEq(out[0].fingerprint, `ORPHAN_ATTEMPT|${ATT1}`, "orphan_attempt: fingerprint by attempt_id");
  assertEq(out[0].metadata.merchant_txn_id, "TXN_ORPHAN", "orphan_attempt: merchant_txn_id in metadata");
  assertEq(out[0].metadata.amount, "900.00", "orphan_attempt: amount in metadata");
}

async function test_dues_exceed_collected_hostel_overcollection() {
  await installPrismaRouter([{
    match: /WITH collected AS/,
    rows: [{
      hostel_id: H_1,
      collected: "50000.00",
      obligated: "45000.00",
      excess: "5000.00",
    }],
  }]);
  const svc = new FinancialReconciliationService();
  const out = await svc.detectDuesExceedCollected();
  assertEq(out.length, 1, "dues_exceed: 1 issue");
  assertEq(out[0].kind, DETECTOR_KIND.DUES_EXCEED_COLLECTED, "dues_exceed: kind");
  assertEq(out[0].severity, "CRITICAL", "dues_exceed: severity CRITICAL");
  assertEq(out[0].fingerprint, `DUES_EXCEED_COLLECTED|${H_1}`, "dues_exceed: fingerprint by hostel_id");
  assertEq(out[0].hostel_id, H_1, "dues_exceed: hostel_id set");
  assertEq(out[0].owner_id, null, "dues_exceed: owner_id null (hostel-level aggregate)");
  assertEq(out[0].metadata.excess, "5000.00", "dues_exceed: excess in metadata");
}

async function test_clean_scan_returns_no_issues() {
  // All detectors return empty rows — total issue count must be zero.
  await installPrismaRouter([]);
  const svc = new FinancialReconciliationService();
  const report = await svc.detectAll();
  assertEq(report.issues.length, 0, "clean_scan: 0 issues");
  assertEq(report.summary.length, 7, "clean_scan: 7 detector summaries");
  assert(report.summary.every((s) => s.count === 0), "clean_scan: all detector counts are 0");
  assert(report.summary.every((s) => !s.error), "clean_scan: no detector errors");
}

async function test_persist_dedup_p2002_counts_as_skipped() {
  // Simulate the partial-unique-index collision: same OPEN fingerprint
  // already on file. The P2002 should be silently counted as 'skipped'.
  const { prisma: p }: any = await import("../db");
  let createCallCount = 0;
  p.financial_reconciliation_issues = {
    create: async () => {
      createCallCount++;
      if (createCallCount === 1) throw Object.assign(new Error("udx_fri_fingerprint_open"), { code: "P2002" });
      return {};
    },
  };

  const svc = new FinancialReconciliationService();
  const fakeReport = {
    started_at: new Date(), finished_at: new Date(), total_ms: 1,
    summary: [],
    issues: [
      {
        kind: DETECTOR_KIND.DUPLICATE_PAYMENT,
        severity: "CRITICAL" as const,
        fingerprint: "DUPLICATE_PAYMENT|test-1",
        description: "test dup",
        owner_id: O_A, hostel_id: H_1,
        payment_id: PAY1, ledger_entry_id: null, batch_id: null, batch_item_id: null,
        metadata: {},
      },
      {
        kind: DETECTOR_KIND.ORPHAN_ATTEMPT,
        severity: "CRITICAL" as const,
        fingerprint: "ORPHAN_ATTEMPT|test-2",
        description: "test orphan",
        owner_id: O_A, hostel_id: H_1,
        payment_id: null, ledger_entry_id: null, batch_id: null, batch_item_id: null,
        metadata: {},
      },
    ],
  };

  const result = await svc.persistIssues(fakeReport, { actorId: "admin-test" });
  assertEq(result.inserted, 1, "persist_dedup: 1 inserted");
  assertEq(result.skipped, 1, "persist_dedup: 1 skipped (P2002 dedup)");
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n=== FinancialReconciliationService — Phase 6 regression suite ===\n");

  console.log("1. DUPLICATE_PAYMENT");
  await test_duplicate_payment_same_attempt_two_rows();

  console.log("\n2. WEBHOOK_MISMATCH");
  await test_webhook_mismatch_stuck_pending_verification();

  console.log("\n3. STALE_PROCESSING");
  await test_stale_processing_crashed_finalization();

  console.log("\n4. HOSTEL_ISOLATION_DRIFT");
  await test_hostel_isolation_drift_cross_attribution();

  console.log("\n5. OBLIGATION_AMOUNT_MISMATCH (overpaid)");
  await test_obligation_amount_mismatch_overpaid();

  console.log("\n6. OBLIGATION_AMOUNT_MISMATCH (underpaid marked PAID)");
  await test_obligation_amount_mismatch_underpaid_marked_paid();

  console.log("\n7. ORPHAN_ATTEMPT");
  await test_orphan_attempt_success_without_payment_row();

  console.log("\n8. DUES_EXCEED_COLLECTED");
  await test_dues_exceed_collected_hostel_overcollection();

  console.log("\n9. Clean scan (0 issues)");
  await test_clean_scan_returns_no_issues();

  console.log("\n10. Persist dedup (P2002 → skipped)");
  await test_persist_dedup_p2002_counts_as_skipped();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFailed tests:");
    failures.forEach((f) => console.error(f));
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
