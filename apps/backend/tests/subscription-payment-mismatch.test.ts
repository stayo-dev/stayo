/**
 * Phase 6.9 — payment-amount mismatch hardening.
 *
 * The server-calculated amount stays authoritative for the invoice (unchanged
 * from Phases 6.5/6.6). This phase adds a purely ADDITIVE, non-blocking
 * admin-visible signal when a payment's declared `amount_paise` doesn't match
 * what the server would have calculated — never a rejection, never a change
 * to what the invoice actually charges.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeExpectedTotalPaise } from "@/src/services/platform-billing/subscription-rules";

describe("computeExpectedTotalPaise — pure", () => {
  it("NEW: plan price + extra beds x price, ignores nothing (no proration)", () => {
    const total = computeExpectedTotalPaise({
      kind: "NEW",
      invoicedPlanPricePaise: 149900,
      currentPlanPricePaise: 149900,
      invoicedPlanExtraBedPricePaise: 1000,
      requestedExtraBeds: 7,
      currentExtraBeds: 0,
      daysRemaining: 0,
      daysInPeriod: 0,
    });
    expect(total).toBe(149900 + 7000);
  });

  it("RENEWAL: full recurring total on the full extra-bed count (not incremental)", () => {
    const total = computeExpectedTotalPaise({
      kind: "RENEWAL",
      invoicedPlanPricePaise: 449900,
      currentPlanPricePaise: 449900,
      invoicedPlanExtraBedPricePaise: 1000,
      requestedExtraBeds: 20,
      currentExtraBeds: 20,
      daysRemaining: 0,
      daysInPeriod: 0,
    });
    expect(total).toBe(449900 + 20000);
  });

  it("UPGRADE: prorated plan delta + full extra-bed cost", () => {
    const total = computeExpectedTotalPaise({
      kind: "UPGRADE",
      invoicedPlanPricePaise: 249900,
      currentPlanPricePaise: 149900,
      invoicedPlanExtraBedPricePaise: 1000,
      requestedExtraBeds: 7,
      currentExtraBeds: 7,
      daysRemaining: 30,
      daysInPeriod: 30,
    });
    // full 30/30 days remaining -> full delta (100000) + 7000 extra = 107000
    expect(total).toBe(107000);
  });

  it("EXTRA_BEDS: only the incremental beds, no plan component", () => {
    const total = computeExpectedTotalPaise({
      kind: "EXTRA_BEDS",
      invoicedPlanPricePaise: 149900,
      currentPlanPricePaise: 149900,
      invoicedPlanExtraBedPricePaise: 1000,
      requestedExtraBeds: 7,
      currentExtraBeds: 3,
      daysRemaining: 0,
      daysInPeriod: 0,
    });
    expect(total).toBe(4 * 1000); // (7-3) incremental beds only
  });

  it("DOWNGRADE: always 0 — a scheduling action, no charge now", () => {
    const total = computeExpectedTotalPaise({
      kind: "DOWNGRADE",
      invoicedPlanPricePaise: 149900,
      currentPlanPricePaise: 249900,
      invoicedPlanExtraBedPricePaise: 1000,
      requestedExtraBeds: 5,
      currentExtraBeds: 20,
      daysRemaining: 0,
      daysInPeriod: 0,
    });
    expect(total).toBe(0);
  });
});

// ── integration: getExpectedAmount + reviewPayment mismatch signal ─────────
const STARTER = { id: "p-starter", code: "STARTER", price_paise: 149900, included_beds: 50, max_extra_beds: 10, extra_bed_price_paise: 1000, is_active: true, name: "Starter" };
const GROWTH = { id: "p-growth", code: "GROWTH", price_paise: 249900, included_beds: 100, max_extra_beds: 25, extra_bed_price_paise: 1000, is_active: true, name: "Growth" };
const PLAN_BY_ID: Record<string, any> = { [STARTER.id]: STARTER, [GROWTH.id]: GROWTH };

vi.mock("@/lib/db", () => {
  const prisma: any = {
    owner_subscriptions: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn(async () => 0) },
    subscription_plans: { findUnique: vi.fn() },
    subscription_payments: { findFirst: vi.fn(async () => null), create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    subscription_invoices: { create: vi.fn() },
    profile: { findFirst: vi.fn() },
    tenants: { count: vi.fn(async () => 0) },
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (cb: any) => cb(prisma)),
  };
  return { prisma };
});
const { eventLogMock } = vi.hoisted(() => ({ eventLogMock: { log: vi.fn(async () => undefined) } }));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: eventLogMock }));

import { prisma } from "@/lib/db";
import { subscriptionPaymentService } from "@/src/services/platform-billing/subscription-payment-service";

const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (cb: any) => cb(db));
  db.subscription_plans.findUnique.mockImplementation(async ({ where }: any) => (where?.id ? PLAN_BY_ID[where.id] ?? null : null));
  db.subscription_invoices.create.mockImplementation(async ({ data }: any) => ({ id: "inv-x", invoice_number: "SUB-2026-X", ...data }));
});

describe("getExpectedAmount — read-only mismatch detection", () => {
  it("exact declared amount -> no mismatch", async () => {
    db.subscription_payments.findUnique.mockResolvedValue({ id: "pay-1", subscription_id: "s1", plan_id: STARTER.id, extra_beds: 7, amount_paise: 156900 });
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", plan_id: STARTER.id, status: "PENDING_PAYMENT", extra_beds: 0, pending_plan_id: null, current_period_start: null, current_period_end: null });
    const r = await subscriptionPaymentService.getExpectedAmount("pay-1");
    expect(r).toMatchObject({ kind: "NEW", expectedAmountPaise: 156900, declaredAmountPaise: 156900, mismatch: false });
  });

  it("declared amount TOO HIGH -> mismatch true, expected amount unaffected", async () => {
    db.subscription_payments.findUnique.mockResolvedValue({ id: "pay-2", subscription_id: "s1", plan_id: STARTER.id, extra_beds: 7, amount_paise: 999900 });
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", plan_id: STARTER.id, status: "PENDING_PAYMENT", extra_beds: 0, pending_plan_id: null, current_period_start: null, current_period_end: null });
    const r = await subscriptionPaymentService.getExpectedAmount("pay-2");
    expect(r).toMatchObject({ kind: "NEW", expectedAmountPaise: 156900, declaredAmountPaise: 999900, mismatch: true });
  });

  it("declared amount TOO LOW -> mismatch true", async () => {
    db.subscription_payments.findUnique.mockResolvedValue({ id: "pay-3", subscription_id: "s1", plan_id: STARTER.id, extra_beds: 7, amount_paise: 1000 });
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", plan_id: STARTER.id, status: "PENDING_PAYMENT", extra_beds: 0, pending_plan_id: null, current_period_start: null, current_period_end: null });
    const r = await subscriptionPaymentService.getExpectedAmount("pay-3");
    expect(r).toMatchObject({ kind: "NEW", expectedAmountPaise: 156900, declaredAmountPaise: 1000, mismatch: true });
  });

  it("RENEWAL mismatch is detected the same way", async () => {
    db.subscription_payments.findUnique.mockResolvedValue({ id: "pay-4", subscription_id: "s1", plan_id: GROWTH.id, extra_beds: 25, amount_paise: 1 });
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", plan_id: GROWTH.id, status: "ACTIVE", extra_beds: 25, pending_plan_id: null, current_period_start: new Date("2026-09-01"), current_period_end: new Date("2026-10-01") });
    const r = await subscriptionPaymentService.getExpectedAmount("pay-4");
    expect(r).toMatchObject({ kind: "RENEWAL", expectedAmountPaise: 249900 + 25000, mismatch: true });
  });

  it("EXTRA_BEDS mismatch: expected is priced on the incremental beds only", async () => {
    db.subscription_payments.findUnique.mockResolvedValue({ id: "pay-5", subscription_id: "s1", plan_id: STARTER.id, extra_beds: 10, amount_paise: 999 });
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", plan_id: STARTER.id, status: "ACTIVE", extra_beds: 3, pending_plan_id: null, current_period_start: new Date("2026-09-01"), current_period_end: new Date("2026-10-01") });
    const r = await subscriptionPaymentService.getExpectedAmount("pay-5");
    expect(r).toMatchObject({ kind: "EXTRA_BEDS", expectedAmountPaise: 7 * 1000, mismatch: true });
  });

  it("returns null for a stale/unknown payment id rather than throwing", async () => {
    db.subscription_payments.findUnique.mockResolvedValue(null);
    const r = await subscriptionPaymentService.getExpectedAmount("does-not-exist");
    expect(r).toBeNull();
  });
});

describe("reviewPayment — mismatch is audited and visible, never blocks approval or changes the invoice", () => {
  it("approves a mismatched NEW payment; invoice uses the server amount; audit records both the declared and expected amounts", async () => {
    db.subscription_payments.findUnique.mockResolvedValue({
      id: "pay-tamper", owner_id: "o1", subscription_id: "s1", plan_id: STARTER.id,
      amount_paise: 999900, extra_beds: 7, payment_method: "CASH", status: "SUBMITTED",
    });
    db.subscription_payments.updateMany.mockResolvedValue({ count: 1 });
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", status: "PENDING_PAYMENT", plan_id: STARTER.id, extra_beds: 0, pending_plan_id: null,
      started_at: null, current_period_start: null, current_period_end: null,
    });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", ...data }));

    const result = await subscriptionPaymentService.reviewPayment({ paymentId: "pay-tamper", decision: "APPROVE", adminId: "admin-1" });

    // Approval is NOT blocked by the mismatch.
    expect(result.payment.status).toBe("APPROVED");
    // Invoice still uses the server-calculated amount, not the declared one.
    expect(result.invoice.amount_paise).toBe(156900);

    const auditCall: any = eventLogMock.log.mock.calls.find((c: any) => c[0] === "SUBSCRIPTION_PAYMENT_APPROVED");
    expect(auditCall).toBeTruthy();
    const metadata = auditCall[2];
    expect(metadata.amount_paise).toBe(999900); // what was declared
    expect(metadata.expected_amount_paise).toBe(156900); // what the server expected
    expect(metadata.amount_mismatch).toBe(true);

    // No sensitive data anywhere in the audit metadata.
    const blob = JSON.stringify(metadata);
    expect(blob).not.toMatch(/proof_file|transaction_reference|upi_vpa/i);
  });

  it("an exact-match payment is recorded as no-mismatch", async () => {
    db.subscription_payments.findUnique.mockResolvedValue({
      id: "pay-exact", owner_id: "o1", subscription_id: "s1", plan_id: STARTER.id,
      amount_paise: 156900, extra_beds: 7, payment_method: "CASH", status: "SUBMITTED",
    });
    db.subscription_payments.updateMany.mockResolvedValue({ count: 1 });
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", status: "PENDING_PAYMENT", plan_id: STARTER.id, extra_beds: 0, pending_plan_id: null,
      started_at: null, current_period_start: null, current_period_end: null,
    });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", ...data }));

    await subscriptionPaymentService.reviewPayment({ paymentId: "pay-exact", decision: "APPROVE", adminId: "admin-1" });

    const auditCall: any = eventLogMock.log.mock.calls.find((c: any) => c[0] === "SUBSCRIPTION_PAYMENT_APPROVED");
    const metadata = auditCall[2];
    expect(metadata.amount_mismatch).toBe(false);
    expect(metadata.expected_amount_paise).toBe(156900);
  });
});
