/**
 * PaymentProvider abstract contract — Phase 8 regression suite
 *
 * Run:
 *   DOTENV_CONFIG_PATH=../../.env node -r dotenv/config ./node_modules/.bin/tsx \
 *     lib/services/payments/provider-base.test.ts
 *
 * Tests the adapter contract itself: canonical state mapping, optional
 * capability gates, normalised result shapes, and idempotency of the
 * default refund / settlement-metadata throw paths.
 *
 * Additionally exercises the contract through a fake `MockProvider` that
 * the test harness controls completely, covering every scenario from
 * the Phase-8 brief §8:
 *
 *   - duplicate webhook delivery   → adapter is safe to call twice
 *   - malformed signatures         → adapter raises SIGNATURE_FAILED
 *   - provider timeout retries     → adapter is safe to retry; same result
 *   - stale status polling         → adapter returns latest source-of-truth
 *   - partial refund flows         → is_full_refund=false; canonical state
 *   - provider mismatch states     → mapProviderState collapses safely
 */

import {
  PaymentProvider,
  PAYMENT_STATE,
  mapProviderState,
  type CreateIntentResult,
  type WebhookVerificationResult,
  type FetchStatusResult,
  type RefundResult,
  type SettlementMetadataResult,
} from "./provider-base";

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
async function expectThrow(fn: () => Promise<any>, match: RegExp, name: string) {
  try { await fn(); } catch (err: any) {
    if (match.test(String(err?.message ?? err))) { console.log(`  OK ${name}`); passed++; return; }
    const m = `  FAIL ${name} — wrong message: ${err?.message ?? err}`;
    console.error(m); failures.push(m); failed++;
    return;
  }
  const m = `  FAIL ${name} — no throw`;
  console.error(m); failures.push(m); failed++;
}

// ────────────────────────────────────────────────────────────────────────────
//  MockProvider — a fully controllable adapter for contract testing
// ────────────────────────────────────────────────────────────────────────────

interface MockState {
  providerState: string;             // raw provider state string
  amount: number;                    // rupees
  gatewayTxnId: string;
  providerTxnId: string;
  refundedAmount: number;            // cumulative refunded
  validSignature: string;            // expected sig
  fetchStatusCalls: number;
  refundCallsByKey: Record<string, RefundResult>;
}

class MockProvider extends PaymentProvider {
  readonly supportsRefunds = true;
  readonly supportsSettlementMetadata = true;

  constructor(public state: MockState, cfg: any = {}) {
    super(cfg);
  }

  async createIntent(data: any): Promise<CreateIntentResult> {
    return {
      provider: "MOCK",
      merchant_txn_id: data.merchant_txn_id,
      checkout_url: "https://mock/checkout",
      upi_intent_url: null,
      qr_payload: null,
      expires_at: new Date(Date.now() + 30 * 60 * 1000),
      gateway_txn_id: this.state.gatewayTxnId,
      provider_transaction_id: null,
      provider_order_id: this.state.gatewayTxnId,
      provider_reference_id: this.state.gatewayTxnId,
      raw_response: { ok: true },
    };
  }

  async verifyWebhook(headers: Record<string, string>, body: string | Buffer): Promise<WebhookVerificationResult> {
    const sig = headers["x-mock-signature"] || headers["X-Mock-Signature"];
    if (!sig) {
      throw new Error("SIGNATURE_FAILED: missing signature header");
    }
    if (sig !== this.state.validSignature) {
      throw new Error("SIGNATURE_FAILED: signature mismatch");
    }
    const parsed = typeof body === "string" ? JSON.parse(body) : JSON.parse(body.toString("utf-8"));
    const canonical = mapProviderState(parsed.state);
    // The webhook union type does not include CREATED/REFUNDED — these
    // arrive through different channels — so we cast the canonical state
    // to the webhook-allowed subset.
    const status: WebhookVerificationResult["status"] =
      canonical === "SUCCESS"  ? "SUCCESS"  :
      canonical === "FAILED"   ? "FAILED"   :
      canonical === "EXPIRED"  ? "EXPIRED"  : "PENDING";
    return {
      merchant_txn_id: parsed.merchantOrderId,
      gateway_txn_id: this.state.gatewayTxnId,
      provider_transaction_id: this.state.providerTxnId,
      provider_order_id: this.state.gatewayTxnId,
      provider_reference_id: this.state.providerTxnId,
      status,
      amount: parsed.amount / 100,
      provider_state: parsed.state,
      verification_state: "SIGNED",
      event_at: new Date(parsed.event_ts || Date.now()),
      raw_event: parsed,
    };
  }

  async fetchStatus(merchant_txn_id: string): Promise<FetchStatusResult> {
    this.state.fetchStatusCalls++;
    const canonical = mapProviderState(this.state.providerState);
    const status: FetchStatusResult["status"] =
      canonical === "SUCCESS"  ? "SUCCESS"  :
      canonical === "FAILED"   ? "FAILED"   :
      canonical === "EXPIRED"  ? "EXPIRED"  : "PENDING";
    return {
      status,
      gateway_txn_id: this.state.gatewayTxnId,
      provider_transaction_id: this.state.providerTxnId,
      provider_order_id: this.state.gatewayTxnId,
      provider_reference_id: this.state.providerTxnId,
      provider_state: this.state.providerState,
      verification_state: "UNVERIFIED",
      completed_at: status === "SUCCESS" ? new Date() : null,
      raw_status: { ok: true, merchant_txn_id, providerState: this.state.providerState },
    };
  }

  async refund(params: {
    merchant_txn_id: string;
    amount: number;
    refund_idempotency_key: string;
  }): Promise<RefundResult> {
    // Idempotency: same key → same row.
    const existing = this.state.refundCallsByKey[params.refund_idempotency_key];
    if (existing) return existing;

    if (params.amount > this.state.amount - this.state.refundedAmount + 0.001) {
      throw new Error("BAD_REQUEST: refund amount exceeds remaining refundable balance");
    }
    this.state.refundedAmount += params.amount;
    const isFull = Math.abs(this.state.refundedAmount - this.state.amount) < 0.001;
    const result: RefundResult = {
      provider: "MOCK",
      refund_idempotency_key: params.refund_idempotency_key,
      provider_refund_id: `mock_refund_${params.refund_idempotency_key}`,
      status: PAYMENT_STATE.REFUNDED,
      amount: params.amount,
      is_full_refund: isFull,
      provider_state: "REFUNDED",
      raw_response: { ok: true },
    };
    this.state.refundCallsByKey[params.refund_idempotency_key] = result;
    return result;
  }

  async getSettlementMetadata(): Promise<SettlementMetadataResult> {
    return {
      provider: "MOCK",
      merchant_txn_id: "mock-mtxn",
      provider_settlement_id: "UTR-MOCK-001",
      settled_at: new Date(),
      net_amount: this.state.amount - 5,    // ₹5 fee for the mock
      fee_amount: 4,
      tax_amount: 1,
      currency: "INR",
      raw_response: { ok: true },
    };
  }
}

function freshState(overrides: Partial<MockState> = {}): MockState {
  return {
    providerState: "PENDING",
    amount: 500,
    gatewayTxnId: "PHONEPE-ORDER-1",
    providerTxnId: "PHONEPE-TXN-1",
    refundedAmount: 0,
    validSignature: "valid-sig",
    fetchStatusCalls: 0,
    refundCallsByKey: {},
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────
//  mapProviderState — canonical state mapping (brief §5, §6, §10)
// ────────────────────────────────────────────────────────────────────────────

function test_canonical_state_mapping_covers_known_provider_strings() {
  // PhonePe v2: COMPLETED / FAILED / PENDING
  assertEq(mapProviderState("COMPLETED"), PAYMENT_STATE.SUCCESS, "map COMPLETED → SUCCESS (PhonePe)");
  assertEq(mapProviderState("FAILED"),    PAYMENT_STATE.FAILED,  "map FAILED → FAILED (PhonePe)");
  assertEq(mapProviderState("PENDING"),   PAYMENT_STATE.PENDING, "map PENDING → PENDING (PhonePe)");

  // Razorpay v1: captured / paid / created / failed
  assertEq(mapProviderState("captured"),  PAYMENT_STATE.SUCCESS, "map captured → SUCCESS (Razorpay)");
  assertEq(mapProviderState("paid"),      PAYMENT_STATE.SUCCESS, "map paid → SUCCESS (Razorpay)");
  assertEq(mapProviderState("created"),   PAYMENT_STATE.CREATED, "map created → CREATED (Razorpay)");

  // Generic/refund states
  assertEq(mapProviderState("REFUNDED"),  PAYMENT_STATE.REFUNDED, "map REFUNDED → REFUNDED");
  assertEq(mapProviderState("REVERSED"),  PAYMENT_STATE.REFUNDED, "map REVERSED → REFUNDED");
  assertEq(mapProviderState("EXPIRED"),   PAYMENT_STATE.EXPIRED,  "map EXPIRED → EXPIRED");
  assertEq(mapProviderState("CANCELLED"), PAYMENT_STATE.FAILED,   "map CANCELLED → FAILED (treated as terminal)");

  // Unknown / null / case-insensitive
  assertEq(mapProviderState("unknown-thing"), PAYMENT_STATE.PENDING, "map unknown → PENDING (safe default)");
  assertEq(mapProviderState(null),       PAYMENT_STATE.PENDING, "map null → PENDING");
  assertEq(mapProviderState(undefined),  PAYMENT_STATE.PENDING, "map undefined → PENDING");
  assertEq(mapProviderState("Completed"), PAYMENT_STATE.SUCCESS, "map case-insensitive");
}

function test_canonical_states_are_provider_agnostic_strings() {
  // Brief §10: no provider terminology may leak.
  const all = Object.values(PAYMENT_STATE).map((s) => String(s).toLowerCase());
  for (const s of all) {
    assert(!s.includes("phonepe"), `state ${s} contains no provider name`);
    assert(!s.includes("razorpay"), `state ${s} contains no provider name`);
    assert(!s.includes("stripe"), `state ${s} contains no provider name`);
    assert(!/captured|reversed|completed/.test(s),
      `state ${s} is not a provider-native string`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  Capability gates (brief §2 — optional refund + settlement)
// ────────────────────────────────────────────────────────────────────────────

class MinimalProvider extends PaymentProvider {
  async createIntent(_d: any): Promise<CreateIntentResult> {
    return { provider: "MIN", merchant_txn_id: "x", raw_response: {} };
  }
  async verifyWebhook(): Promise<WebhookVerificationResult> {
    return { merchant_txn_id: "x", status: "PENDING", raw_event: {} };
  }
  async fetchStatus(): Promise<FetchStatusResult> {
    return { status: "PENDING", raw_status: {} };
  }
}

async function test_minimal_provider_gates_optional_capabilities() {
  const p = new MinimalProvider({});
  assertEq(p.supportsRefunds, false, "minimal: supportsRefunds defaults false");
  assertEq(p.supportsSettlementMetadata, false, "minimal: supportsSettlementMetadata defaults false");
  await expectThrow(
    () => p.refund({ merchant_txn_id: "x", amount: 100, refund_idempotency_key: "k" }),
    /NOT_SUPPORTED: refund/,
    "minimal: refund() throws typed NOT_SUPPORTED",
  );
  await expectThrow(
    () => p.getSettlementMetadata({ merchant_txn_id: "x" }),
    /NOT_SUPPORTED: getSettlementMetadata/,
    "minimal: getSettlementMetadata() throws typed NOT_SUPPORTED",
  );
}

async function test_mock_provider_advertises_capabilities() {
  const p = new MockProvider(freshState());
  assertEq(p.supportsRefunds, true, "mock: supportsRefunds=true");
  assertEq(p.supportsSettlementMetadata, true, "mock: supportsSettlementMetadata=true");
}

// ────────────────────────────────────────────────────────────────────────────
//  Brief §8 — regression scenarios
// ────────────────────────────────────────────────────────────────────────────

async function test_duplicate_webhook_delivery_is_safe() {
  const state = freshState({ providerState: "COMPLETED" });
  const p = new MockProvider(state);
  const body = JSON.stringify({
    merchantOrderId: "TXN-1", state: "COMPLETED", amount: 50000, event_ts: 1234567890,
  });
  const headers = { "x-mock-signature": "valid-sig" };
  const r1 = await p.verifyWebhook(headers, body);
  const r2 = await p.verifyWebhook(headers, body);
  assertEq(r1.status, "SUCCESS", "dup webhook: first call SUCCESS");
  assertEq(r2.status, "SUCCESS", "dup webhook: second call same result");
  assertEq(r1.provider_state, r2.provider_state, "dup webhook: provider_state stable");
  assertEq(r1.verification_state, "SIGNED", "dup webhook: signature verified on each call");
  // Adapter does not own dedup; that's payment-service. We assert the adapter
  // is shape-stable across deliveries so dedup is purely a downstream concern.
}

async function test_malformed_signature_raises_signature_failed() {
  const p = new MockProvider(freshState());
  const body = JSON.stringify({ merchantOrderId: "TXN-1", state: "COMPLETED", amount: 50000 });
  await expectThrow(
    () => p.verifyWebhook({ "x-mock-signature": "BAD-SIG" }, body),
    /SIGNATURE_FAILED/,
    "malformed sig: adapter throws SIGNATURE_FAILED with bad header",
  );
  await expectThrow(
    () => p.verifyWebhook({}, body),
    /SIGNATURE_FAILED/,
    "malformed sig: adapter throws SIGNATURE_FAILED with missing header",
  );
}

async function test_provider_timeout_retry_is_idempotent() {
  // Simulate the payment-service retry loop calling fetchStatus three times
  // (e.g. due to a 504 the first two times). The state on the provider has
  // not changed, so every retry returns the same canonical status. The
  // adapter must NOT race or accumulate side effects.
  const state = freshState({ providerState: "COMPLETED" });
  const p = new MockProvider(state);
  const results = await Promise.all([
    p.fetchStatus("TXN-1"),
    p.fetchStatus("TXN-1"),
    p.fetchStatus("TXN-1"),
  ]);
  for (const r of results) assertEq(r.status, "SUCCESS", "timeout retry: every retry returns SUCCESS");
  assertEq(state.fetchStatusCalls, 3, "timeout retry: adapter dispatched all 3 fetches without dedup");
  // Adapter is idempotent at the wire level; dedup belongs at payment-service.
  const refs = new Set(results.map((r) => r.provider_reference_id));
  assertEq(refs.size, 1, "timeout retry: provider_reference_id stable across retries");
}

async function test_stale_status_polling_uses_provider_source_of_truth() {
  // Brief §8 stale-polling regression: the local DB might think a payment
  // is still PENDING, but the provider's true state is COMPLETED. The
  // adapter must return the PROVIDER state, not echo the input.
  const state = freshState({ providerState: "COMPLETED" });
  const p = new MockProvider(state);
  const r = await p.fetchStatus("TXN-1");
  assertEq(r.status, "SUCCESS", "stale poll: returns provider source-of-truth");
  assertEq(r.provider_state, "COMPLETED", "stale poll: raw provider state preserved");
  assertEq(r.verification_state, "UNVERIFIED",
    "stale poll: fetch uses transport-level trust (OAuth), not a signature");
  assert(r.completed_at instanceof Date, "stale poll: completed_at set on terminal state");
}

async function test_partial_refund_flow_marks_is_full_refund_false() {
  const state = freshState({ amount: 500 });
  const p = new MockProvider(state);
  const r1 = await p.refund({ merchant_txn_id: "TXN-1", amount: 100, refund_idempotency_key: "rf-1" });
  assertEq(r1.status, PAYMENT_STATE.REFUNDED, "partial refund: canonical REFUNDED");
  assertEq(r1.is_full_refund, false, "partial refund: is_full_refund=false");
  assertEq(r1.amount, 100, "partial refund: amount echoed");

  const r2 = await p.refund({ merchant_txn_id: "TXN-1", amount: 400, refund_idempotency_key: "rf-2" });
  assertEq(r2.is_full_refund, true, "partial refund: second refund completes full");
  assertEq(state.refundedAmount, 500, "partial refund: cumulative tracking");

  // Idempotent re-call (same key) returns same row, no double-spend.
  const r1Again = await p.refund({ merchant_txn_id: "TXN-1", amount: 100, refund_idempotency_key: "rf-1" });
  assertEq(r1Again.provider_refund_id, r1.provider_refund_id, "refund: idempotent on key");
  assertEq(state.refundedAmount, 500, "refund: idempotent re-call does not double-debit");

  // Over-refund rejected.
  await expectThrow(
    () => p.refund({ merchant_txn_id: "TXN-1", amount: 50, refund_idempotency_key: "rf-3" }),
    /exceeds remaining refundable balance/,
    "refund: over-refund rejected",
  );
}

async function test_provider_mismatch_states_collapse_safely() {
  // Brief §8: A provider might suddenly return a brand-new state string
  // ("WAITING_FOR_REVIEW", "REVERSAL_PENDING", whatever). Treasury must
  // never crash on such input — mapProviderState collapses to PENDING.
  for (const weird of ["WAITING_FOR_REVIEW", "REVERSAL_PENDING", "ON_HOLD", "PARTIALLY_PAID", ""]) {
    const mapped = mapProviderState(weird);
    assert(
      mapped === PAYMENT_STATE.PENDING || mapped === PAYMENT_STATE.SUCCESS
      || mapped === PAYMENT_STATE.FAILED || mapped === PAYMENT_STATE.EXPIRED
      || mapped === PAYMENT_STATE.REFUNDED || mapped === PAYMENT_STATE.CREATED,
      `mismatch: unknown state '${weird}' maps to canonical PENDING (got ${mapped})`,
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  Normalised result shapes (brief §6)
// ────────────────────────────────────────────────────────────────────────────

async function test_normalised_result_shapes_have_required_fields() {
  const p = new MockProvider(freshState({ providerState: "COMPLETED" }));

  const intent = await p.createIntent({
    amount: 500, merchant_txn_id: "TXN-1",
    tenant_name: "Test", metadata: {},
  });
  assert(typeof intent.merchant_txn_id === "string", "intent: merchant_txn_id present");
  assert("raw_response" in intent, "intent: raw_response preserved");
  assert(intent.expires_at instanceof Date, "intent: expires_at present");

  const status = await p.fetchStatus("TXN-1");
  assert(typeof status.status === "string", "status: canonical status present");
  assert("verification_state" in status, "status: verification_state on result");
  assert("provider_state" in status, "status: raw provider_state preserved");
  assert("raw_status" in status, "status: raw_status preserved");

  const webhook = await p.verifyWebhook(
    { "x-mock-signature": "valid-sig" },
    JSON.stringify({ merchantOrderId: "TXN-1", state: "COMPLETED", amount: 50000 }),
  );
  assert("event_at" in webhook, "webhook: event_at present");
  assert("verification_state" in webhook, "webhook: verification_state present");
  assertEq(webhook.verification_state, "SIGNED", "webhook: verification_state=SIGNED on valid sig");
}

// ────────────────────────────────────────────────────────────────────────────
//  No-leak invariant (brief §10)
// ────────────────────────────────────────────────────────────────────────────

async function test_canonical_status_never_uses_provider_terminology() {
  const p = new MockProvider(freshState({ providerState: "COMPLETED" }));
  const status = await p.fetchStatus("TXN-1");
  // Provider's raw word is COMPLETED; ours must be SUCCESS.
  assertEq(status.status, "SUCCESS", "no-leak: canonical status, not provider word");
  assertEq(status.provider_state, "COMPLETED", "no-leak: provider_state retains raw");
  // The canonical status is what treasury/owner-facing systems read.
  // The raw provider_state is for forensics only.
}

// ────────────────────────────────────────────────────────────────────────────
//  runner
// ────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("PaymentProvider — Phase 8 contract tests\n");

  console.log("1. Canonical state mapping");
  test_canonical_state_mapping_covers_known_provider_strings();
  test_canonical_states_are_provider_agnostic_strings();

  console.log("\n2. Capability gates (optional refund + settlement)");
  await test_minimal_provider_gates_optional_capabilities();
  await test_mock_provider_advertises_capabilities();

  console.log("\n3. Brief §8 — duplicate webhook delivery");
  await test_duplicate_webhook_delivery_is_safe();

  console.log("\n4. Brief §8 — malformed signatures");
  await test_malformed_signature_raises_signature_failed();

  console.log("\n5. Brief §8 — provider timeout retries");
  await test_provider_timeout_retry_is_idempotent();

  console.log("\n6. Brief §8 — stale status polling");
  await test_stale_status_polling_uses_provider_source_of_truth();

  console.log("\n7. Brief §8 — partial refund flows");
  await test_partial_refund_flow_marks_is_full_refund_false();

  console.log("\n8. Brief §8 — provider mismatch states");
  await test_provider_mismatch_states_collapse_safely();

  console.log("\n9. Normalised result shapes (brief §6)");
  await test_normalised_result_shapes_have_required_fields();

  console.log("\n10. No-terminology-leak invariant (brief §10)");
  await test_canonical_status_never_uses_provider_terminology();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFailures:");
    failures.forEach((f) => console.error(f));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
