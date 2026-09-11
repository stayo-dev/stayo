/**
 * Phase 6.6 — recurring paid extra-bed billing.
 *
 * Covers what `subscription-extra-beds.test.ts` (Phase 6.5, the capacity
 * model itself) doesn't: the RECURRING nature of extra-bed charges across
 * renewal, the invoice breakdown/reconciliation those charges must produce,
 * upgrade/downgrade interactions with an existing extra-bed count, and that
 * the extra-bed money figures are always server-computed — never trusted
 * from whatever a manual payment's `amount_paise` claims.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateExtraBeds } from "@/src/services/platform-billing/subscription-rules";

const FOUNDING = { id: "p-founding", code: "FOUNDING", price_paise: 200000, included_beds: 250, max_extra_beds: null, extra_bed_price_paise: 1000, is_active: true, name: "Founding" };
const STARTER = { id: "p-starter", code: "STARTER", price_paise: 149900, included_beds: 50, max_extra_beds: 10, extra_bed_price_paise: 1000, is_active: true, name: "Starter" };
const GROWTH = { id: "p-growth", code: "GROWTH", price_paise: 249900, included_beds: 100, max_extra_beds: 25, extra_bed_price_paise: 1000, is_active: true, name: "Growth" };
const PROFESSIONAL = { id: "p-pro", code: "PROFESSIONAL", price_paise: 449900, included_beds: 250, max_extra_beds: 50, extra_bed_price_paise: 1000, is_active: true, name: "Professional" };
const PORTFOLIO = { id: "p-portfolio", code: "PORTFOLIO", price_paise: 799900, included_beds: 500, max_extra_beds: 0, extra_bed_price_paise: null, is_active: true, name: "Portfolio" };
const PLAN_BY_ID: Record<string, any> = { [FOUNDING.id]: FOUNDING, [STARTER.id]: STARTER, [GROWTH.id]: GROWTH, [PROFESSIONAL.id]: PROFESSIONAL, [PORTFOLIO.id]: PORTFOLIO };
const PLAN_BY_CODE: Record<string, any> = { FOUNDING, STARTER, GROWTH, PROFESSIONAL, PORTFOLIO };

vi.mock("@/lib/db", () => {
  const prisma: any = {
    owner_subscriptions: {
      findUnique: vi.fn(), update: vi.fn(), count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []), groupBy: vi.fn(async () => []),
    },
    subscription_plans: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
    subscription_payments: {
      findFirst: vi.fn(async () => null), create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(),
      findMany: vi.fn(async () => []),
    },
    subscription_invoices: { create: vi.fn(), findMany: vi.fn(async () => []) },
    profile: { findFirst: vi.fn() },
    tenants: { count: vi.fn(async () => 0), groupBy: vi.fn(async () => []) },
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
import { subscriptionAdminService } from "@/src/services/platform-billing/subscription-admin-service";
import { subscriptionDowngradeService } from "@/src/services/platform-billing/subscription-downgrade-service";

const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (cb: any) => cb(db));
  db.$queryRaw.mockResolvedValue([]);
  db.subscription_plans.findUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id) return PLAN_BY_ID[where.id] ?? null;
    if (where?.code) return PLAN_BY_CODE[where.code] ?? null;
    return null;
  });
  db.subscription_payments.findFirst.mockResolvedValue(null);
  db.owner_subscriptions.count.mockResolvedValue(0);
  db.tenants.count.mockResolvedValue(0);
  db.subscription_invoices.create.mockImplementation(async ({ data }: any) => ({ id: "inv-x", invoice_number: "SUB-2026-X", ...data }));
});

// ── recurring renewal amount ────────────────────────────────────────────────
describe("recurring renewal: extra-bed charge recurs every period, on the FULL total", () => {
  it("a RENEWAL payment for the same plan + same extra_beds charges plan price + extra_beds × ₹10 again", async () => {
    db.subscription_payments.findUnique.mockResolvedValue({
      id: "pay-r", owner_id: "o1", subscription_id: "s1", plan_id: GROWTH.id,
      amount_paise: 249900 + 25_000, extra_beds: 25, payment_method: "CASH", status: "SUBMITTED",
    });
    db.subscription_payments.updateMany.mockResolvedValue({ count: 1 });
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: GROWTH.id, extra_beds: 25, pending_plan_id: null,
      started_at: new Date("2026-01-01"), current_period_start: new Date("2026-08-01"), current_period_end: new Date("2026-09-01"),
    });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", ...data }));

    const result = await subscriptionPaymentService.reviewPayment({ paymentId: "pay-r", decision: "APPROVE", adminId: "admin-1" });

    // Full recurring amount — 25 beds again, not incremental (unlike EXTRA_BEDS).
    expect(result.invoice.amount_paise).toBe(249900 + 25_000);
    expect(db.owner_subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ extra_beds: 25 }) }),
    );
  });

  it("a renewal that lands a queued downgrade charges the DOWNGRADED plan's price plus its own extra-bed cost", async () => {
    // Owner was on PROFESSIONAL with 10 extra beds, scheduled a downgrade to
    // STARTER, and is now renewing onto STARTER with (a STARTER-compatible) 5
    // extra beds.
    db.subscription_payments.findUnique.mockResolvedValue({
      id: "pay-rd", owner_id: "o1", subscription_id: "s1", plan_id: STARTER.id,
      amount_paise: 149900 + 5_000, extra_beds: 5, payment_method: "CASH", status: "SUBMITTED",
    });
    db.subscription_payments.updateMany.mockResolvedValue({ count: 1 });
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: PROFESSIONAL.id, extra_beds: 10, pending_plan_id: STARTER.id,
      started_at: new Date("2026-01-01"), current_period_start: new Date("2026-08-01"), current_period_end: new Date("2026-09-01"),
    });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", ...data }));

    const result = await subscriptionPaymentService.reviewPayment({ paymentId: "pay-rd", decision: "APPROVE", adminId: "admin-1" });

    expect(result.invoice.amount_paise).toBe(149900 + 5_000);
    expect(db.owner_subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ plan_id: STARTER.id, extra_beds: 5, pending_plan_id: null }) }),
    );
  });
});

// ── invoice reconciliation ──────────────────────────────────────────────────
describe("invoice reconciliation: plan_amount_paise + extra_bed_amount_paise + tax_paise === amount_paise", () => {
  async function approveAndGetInvoiceData(payment: any, subscription: any) {
    db.subscription_payments.findUnique.mockResolvedValue(payment);
    db.subscription_payments.updateMany.mockResolvedValue({ count: 1 });
    db.owner_subscriptions.findUnique.mockResolvedValue(subscription);
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: subscription.id, ...data }));
    await subscriptionPaymentService.reviewPayment({ paymentId: payment.id, decision: "APPROVE", adminId: "admin-1" });
    return db.subscription_invoices.create.mock.calls.at(-1)[0].data;
  }

  it("NEW (first activation) with extra beds reconciles", async () => {
    const data = await approveAndGetInvoiceData(
      { id: "pay-n", owner_id: "o1", subscription_id: "s1", plan_id: STARTER.id, amount_paise: 149900 + 3_000, extra_beds: 3, payment_method: "CASH", status: "SUBMITTED" },
      { id: "s1", owner_id: "o1", status: "PENDING_PAYMENT", plan_id: STARTER.id, extra_beds: 0, pending_plan_id: null, started_at: null, current_period_start: null, current_period_end: null },
    );
    expect(data.plan_amount_paise + data.extra_bed_amount_paise + 0).toBe(data.amount_paise);
    expect(data.plan_amount_paise).toBe(149900);
    expect(data.extra_bed_amount_paise).toBe(3_000);
    expect(data.extra_bed_unit_price_paise).toBe(1000);
  });

  it("UPGRADE (cross-plan, with extra beds carried to the new plan) reconciles", async () => {
    const data = await approveAndGetInvoiceData(
      { id: "pay-u", owner_id: "o1", subscription_id: "s1", plan_id: GROWTH.id, amount_paise: 120000, extra_beds: 8, payment_method: "CASH", status: "SUBMITTED" },
      { id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: STARTER.id, extra_beds: 8, pending_plan_id: null, started_at: new Date(), current_period_start: new Date("2026-09-01"), current_period_end: new Date("2026-10-01") },
    );
    // extra_bed_amount is fully server-computed (8 × ₹10 = 8000) regardless
    // of the arbitrary prorated total the owner/admin actually submitted.
    expect(data.extra_bed_amount_paise).toBe(8_000);
    expect(data.plan_amount_paise).toBe(120000 - 8_000);
    expect(data.plan_amount_paise + data.extra_bed_amount_paise).toBe(data.amount_paise);
  });

  it("EXTRA_BEDS (same-plan top-up) reconciles on the INCREMENTAL beds, not the new total", async () => {
    const data = await approveAndGetInvoiceData(
      { id: "pay-e", owner_id: "o1", subscription_id: "s1", plan_id: STARTER.id, amount_paise: 4_000, extra_beds: 7, payment_method: "CASH", status: "SUBMITTED" },
      { id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: STARTER.id, extra_beds: 3, pending_plan_id: null, started_at: new Date(), current_period_start: new Date("2026-09-01"), current_period_end: new Date("2026-10-01") },
    );
    // 7 total - 3 current = 4 incremental beds × ₹1000 = 4000, matching the payment.
    expect(data.extra_beds).toBe(7); // stored total
    expect(data.extra_bed_amount_paise).toBe(4_000); // charged on the 4 incremental beds only
    expect(data.plan_amount_paise).toBe(0); // no plan component in a same-plan top-up
    expect(data.plan_amount_paise + data.extra_bed_amount_paise).toBe(data.amount_paise);
  });

  it("DOWNGRADE (schedule payment, ₹0) reconciles with no extra-bed component", async () => {
    const data = await approveAndGetInvoiceData(
      { id: "pay-d", owner_id: "o1", subscription_id: "s1", plan_id: STARTER.id, amount_paise: 0, extra_beds: 0, payment_method: "CASH", status: "SUBMITTED" },
      { id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: GROWTH.id, extra_beds: 5, pending_plan_id: null, started_at: new Date(), current_period_start: new Date("2026-09-01"), current_period_end: new Date("2026-10-01") },
    );
    expect(data.extra_beds).toBe(0);
    expect(data.extra_bed_amount_paise).toBe(0);
    expect(data.plan_amount_paise).toBe(0);
  });

  it("RENEWAL with extra beds reconciles", async () => {
    const data = await approveAndGetInvoiceData(
      { id: "pay-ren", owner_id: "o1", subscription_id: "s1", plan_id: PROFESSIONAL.id, amount_paise: 449900 + 50_000, extra_beds: 50, payment_method: "CASH", status: "SUBMITTED" },
      { id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: PROFESSIONAL.id, extra_beds: 50, pending_plan_id: null, started_at: new Date("2026-01-01"), current_period_start: new Date("2026-08-01"), current_period_end: new Date("2026-09-01") },
    );
    expect(data.plan_amount_paise).toBe(449900);
    expect(data.extra_bed_amount_paise).toBe(50_000);
    expect(data.plan_amount_paise + data.extra_bed_amount_paise).toBe(data.amount_paise);
  });
});

// ── tampering resistance ────────────────────────────────────────────────────
describe("tampering: the extra-bed amount is always server-computed, never influenced by a manipulated payment amount", () => {
  it("NEW/RENEWAL: the invoiced amount ignores whatever the payment claims — it is entirely server-computed from the plan price + extra_beds × ₹10", async () => {
    db.subscription_payments.findUnique.mockResolvedValue({
      id: "pay-tamper", owner_id: "o1", subscription_id: "s1", plan_id: STARTER.id,
      amount_paise: 99_999_900, // absurd, as if the owner/admin typo'd or tried to inflate it
      extra_beds: 3, payment_method: "CASH", status: "SUBMITTED",
    });
    db.subscription_payments.updateMany.mockResolvedValue({ count: 1 });
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", status: "PENDING_PAYMENT", plan_id: STARTER.id, extra_beds: 0, pending_plan_id: null,
      started_at: null, current_period_start: null, current_period_end: null,
    });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", ...data }));

    const result = await subscriptionPaymentService.reviewPayment({ paymentId: "pay-tamper", decision: "APPROVE", adminId: "admin-1" });
    const data = db.subscription_invoices.create.mock.calls.at(-1)[0].data;

    // The inflated 99,999,900 is never used — NEW/RENEWAL always re-derives
    // the amount from the plan's own price + validated extra beds.
    expect(result.invoice.amount_paise).toBe(149900 + 3_000);
    expect(data.plan_amount_paise).toBe(149900);
    expect(data.extra_bed_amount_paise).toBe(3_000);
  });

  it("UPGRADE: an inflated declared total doesn't change the server-computed extra-bed portion — only the (auditable) residual plan portion absorbs it", async () => {
    db.subscription_payments.findUnique.mockResolvedValue({
      id: "pay-tamper-up", owner_id: "o1", subscription_id: "s1", plan_id: GROWTH.id,
      amount_paise: 99_999_900, // absurd
      extra_beds: 3, payment_method: "CASH", status: "SUBMITTED",
    });
    db.subscription_payments.updateMany.mockResolvedValue({ count: 1 });
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: STARTER.id, extra_beds: 0, pending_plan_id: null,
      started_at: new Date(), current_period_start: new Date("2026-09-01"), current_period_end: new Date("2026-10-01"),
    });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", ...data }));

    await subscriptionPaymentService.reviewPayment({ paymentId: "pay-tamper-up", decision: "APPROVE", adminId: "admin-1" });
    const data = db.subscription_invoices.create.mock.calls.at(-1)[0].data;

    // extra_bed_amount_paise is 3 × GROWTH's own extra_bed_price_paise — fixed
    // by server data (quantity + plan row), never by the inflated total.
    expect(data.extra_bed_amount_paise).toBe(3_000);
    // The oversized figure lands entirely in plan_amount_paise (the residual)
    // — visible/auditable, not silently absorbed into the extra-bed line.
    expect(data.plan_amount_paise).toBe(99_999_900 - 3_000);
    expect(data.plan_amount_paise + data.extra_bed_amount_paise).toBe(data.amount_paise);
  });

  it("extra_beds beyond the plan's allowance is refused at approval even if the plan/payment was submitted earlier under a looser plan", async () => {
    db.subscription_payments.findUnique.mockResolvedValue({
      id: "pay-over", owner_id: "o1", subscription_id: "s1", plan_id: STARTER.id,
      amount_paise: 149900 + 11_000, extra_beds: 11, payment_method: "CASH", status: "SUBMITTED",
    });
    db.subscription_payments.updateMany.mockResolvedValue({ count: 1 });
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", status: "PENDING_PAYMENT", plan_id: STARTER.id, extra_beds: 0, pending_plan_id: null,
      started_at: null, current_period_start: null, current_period_end: null,
    });

    await expect(
      subscriptionPaymentService.reviewPayment({ paymentId: "pay-over", decision: "APPROVE", adminId: "admin-1" }),
    ).rejects.toMatchObject({ code: "EXTRA_BEDS_LIMIT_EXCEEDED" });
    expect(db.subscription_invoices.create).not.toHaveBeenCalled();
    expect(db.owner_subscriptions.update).not.toHaveBeenCalled();
  });

  it("createInvoiceForApprovedPayment throws if a caller ever passes a non-reconciling breakdown (defense in depth)", async () => {
    const { createInvoiceForApprovedPayment } = await import("@/src/services/platform-billing/subscription-invoice-service");
    const tx = { subscription_invoices: { create: vi.fn() } };
    await expect(
      createInvoiceForApprovedPayment(tx, {
        ownerId: "o1", subscriptionId: "s1", paymentId: "p1",
        amountPaise: 100000, planAmountPaise: 50000, extraBedAmountPaise: 10000, // 50000+10000 !== 100000
        paymentMethod: "CASH", transactionReference: null,
        billingPeriodStart: new Date(), billingPeriodEnd: new Date(),
      }),
    ).rejects.toThrow(/does not reconcile/);
    expect(tx.subscription_invoices.create).not.toHaveBeenCalled();
  });
});

// ── upgrade/downgrade interactions with an existing extra-bed count ────────
describe("downgrade: an incompatible existing extra-bed count is refused up front, never silently reduced", () => {
  it("owner scheduleDowngrade refuses when current extra_beds exceeds the target plan's allowance", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: PROFESSIONAL.id, extra_beds: 20, pending_plan_id: null,
    });
    await expect(
      subscriptionDowngradeService.scheduleDowngrade("o1", STARTER.id),
    ).rejects.toMatchObject({ code: "EXTRA_BEDS_EXCEEDS_TARGET_PLAN" });
    expect(db.owner_subscriptions.update).not.toHaveBeenCalled();
  });

  it("owner scheduleDowngrade refuses PROFESSIONAL(30 extra) → GROWTH (max 25) — over by 5", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: PROFESSIONAL.id, extra_beds: 30, pending_plan_id: null,
    });
    await expect(
      subscriptionDowngradeService.scheduleDowngrade("o1", GROWTH.id),
    ).rejects.toMatchObject({ code: "EXTRA_BEDS_EXCEEDS_TARGET_PLAN" });
  });

  it("owner scheduleDowngrade succeeds when current extra_beds already fit the target plan", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: PROFESSIONAL.id, extra_beds: 8, pending_plan_id: null,
    });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", ...data }));
    const r = await subscriptionDowngradeService.scheduleDowngrade("o1", STARTER.id); // 8 <= STARTER's 10
    expect(r.pending_plan.code).toBe("STARTER");
  });

  it("owner scheduleDowngrade succeeds when current extra_beds is 0, regardless of target's allowance", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: PROFESSIONAL.id, extra_beds: 0, pending_plan_id: null,
    });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", ...data }));
    const r = await subscriptionDowngradeService.scheduleDowngrade("o1", GROWTH.id);
    expect(r.pending_plan.code).toBe("GROWTH");
  });

  it("admin changePlan NEXT_PERIOD refuses the same incompatible-extra-beds case", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: PROFESSIONAL.id, extra_beds: 20,
    });
    await expect(
      subscriptionAdminService.changePlan({ subscriptionId: "s1", adminId: "a", planId: STARTER.id, effective: "NEXT_PERIOD", reason: "owner request" }),
    ).rejects.toMatchObject({ code: "EXTRA_BEDS_EXCEEDS_TARGET_PLAN" });
    expect(db.owner_subscriptions.update).not.toHaveBeenCalled();
  });

  it("admin changePlan NEXT_PERIOD succeeds when extra beds already fit", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: PROFESSIONAL.id, extra_beds: 5,
    });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", ...data }));
    const r = await subscriptionAdminService.changePlan({ subscriptionId: "s1", adminId: "a", planId: STARTER.id, effective: "NEXT_PERIOD", reason: "owner request" });
    expect(r.pending_plan_id).toBe(STARTER.id);
  });

  it("upgrade (immediate) never discards an existing incompatible extra-bed count silently — it is rejected", async () => {
    // Professional owner with 30 extra beds "upgrading" (by price) into
    // Portfolio, which offers none — must be refused, not silently zeroed.
    db.subscription_payments.findUnique.mockResolvedValue({
      id: "pay-bad-upgrade", owner_id: "o1", subscription_id: "s1", plan_id: PORTFOLIO.id,
      amount_paise: 799900, extra_beds: 30, payment_method: "CASH", status: "SUBMITTED",
    });
    db.subscription_payments.updateMany.mockResolvedValue({ count: 1 });
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: PROFESSIONAL.id, extra_beds: 30, pending_plan_id: null,
      started_at: new Date(), current_period_start: new Date("2026-09-01"), current_period_end: new Date("2026-10-01"),
    });
    await expect(
      subscriptionPaymentService.reviewPayment({ paymentId: "pay-bad-upgrade", decision: "APPROVE", adminId: "admin-1" }),
    ).rejects.toMatchObject({ code: "EXTRA_BEDS_LIMIT_EXCEEDED" });
    expect(db.owner_subscriptions.update).not.toHaveBeenCalled();
  });
});

// ── admin visibility of the recurring extra-bed charge ──────────────────────
describe("admin UI: the recurring extra-bed charge is surfaced alongside the plan price", () => {
  it("listSubscriptions reports recurring_amount_paise = plan price + extra_beds × price, distinct from amount_paise", async () => {
    db.owner_subscriptions.findMany.mockResolvedValue([
      {
        id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: GROWTH.id, extra_beds: 8, pending_plan_id: null,
        current_period_end: null, next_renewal_at: null, admin_override_until: null,
        profile: { id: "o1", name: "Owner", email: "o@x", phone: "" },
        subscription_plans: GROWTH,
        pending_plan: null,
      },
    ]);
    db.owner_subscriptions.count.mockResolvedValue(1);
    db.owner_subscriptions.groupBy.mockImplementation(async ({ by }: any) => {
      if (by?.[0] === "status") return [{ status: "ACTIVE", _count: { _all: 1 } }];
      return [{ plan_id: GROWTH.id, _count: { _all: 1 } }];
    });
    db.tenants.groupBy.mockResolvedValue([{ owner_id: "o1", _count: { _all: 30 } }]);
    db.subscription_payments.findMany.mockResolvedValue([]);
    db.subscription_plans.findMany.mockResolvedValue([{ id: GROWTH.id, code: GROWTH.code }]);

    const r = await subscriptionAdminService.listSubscriptions({});
    const row = r.subscriptions[0];
    expect(row.amount_paise).toBe(249900); // plan-only, unchanged meaning
    expect(row.recurring_amount_paise).toBe(249900 + 8 * 1000); // + recurring extra-bed charge
  });

  it("getSubscriptionDetail reports the same recurring_amount_paise breakdown", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: STARTER.id, extra_beds: 5, pending_plan_id: null,
      profile: { id: "o1", name: "Owner", email: "o@x", phone: "" },
      subscription_plans: STARTER,
      pending_plan: null,
      current_period_start: null, current_period_end: null, next_renewal_at: null,
      started_at: null, cancelled_at: null,
      admin_override_until: null, admin_override_reason: null, admin_override_by: null,
    });
    db.subscription_payments.findMany.mockResolvedValue([]);
    db.subscription_invoices.findMany.mockResolvedValue([]);
    db.tenants.count.mockResolvedValue(50);

    const detail = await subscriptionAdminService.getSubscriptionDetail("s1");
    expect(detail.subscription.amount_paise).toBe(149900);
    expect(detail.subscription.recurring_amount_paise).toBe(149900 + 5 * 1000);
  });
});
