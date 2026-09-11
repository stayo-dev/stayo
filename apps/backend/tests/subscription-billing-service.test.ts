import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const prisma: any = {
    owner_subscriptions: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    subscription_plans: { findUnique: vi.fn(), findMany: vi.fn() },
    subscription_payments: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(async () => []),
      create: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    subscription_invoices: { findMany: vi.fn(async () => []), create: vi.fn() },
    profile: { findMany: vi.fn(async () => []) },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (cb: any) => cb(prisma)),
  };
  return { prisma };
});

const { eventLogMock } = vi.hoisted(() => ({ eventLogMock: { log: vi.fn(async () => undefined) } }));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: eventLogMock }));

import { prisma } from "@/lib/db";
import { subscriptionService } from "@/src/services/platform-billing/subscription-service";
import { subscriptionPaymentService } from "@/src/services/platform-billing/subscription-payment-service";
import { isSubscriptionError } from "@/src/services/platform-billing/subscription-errors";

const db = prisma as any;

const PLANS: Record<string, any> = {
  STARTER: { id: "plan-starter", code: "STARTER", name: "Starter", price_paise: 149900, currency: "INR", billing_cycle: "MONTHLY", capacity_min: 1, capacity_max: 50, is_public: true, is_active: true },
  GROWTH: { id: "plan-growth", code: "GROWTH", name: "Growth", price_paise: 249900, currency: "INR", billing_cycle: "MONTHLY", capacity_min: 51, capacity_max: 100, is_public: true, is_active: true },
  FOUNDING: { id: "plan-founding", code: "FOUNDING", name: "Founding", price_paise: 200000, currency: "INR", billing_cycle: "MONTHLY", capacity_min: 1, capacity_max: null, is_public: false, is_active: true },
};
const PLAN_BY_ID: Record<string, any> = Object.fromEntries(Object.values(PLANS).map((p) => [p.id, p]));

function wirePlanLookups() {
  db.subscription_plans.findUnique.mockImplementation(async ({ where }: any) => {
    if (where?.code) return PLANS[where.code] ?? null;
    if (where?.id) return PLAN_BY_ID[where.id] ?? null;
    return null;
  });
  db.subscription_plans.findMany.mockResolvedValue(Object.values(PLANS));
}

beforeEach(() => {
  vi.clearAllMocks();
  wirePlanLookups();
  db.$transaction.mockImplementation(async (cb: any) => cb(db));
  db.$executeRaw.mockResolvedValue(1);
  // Default: nobody is on FOUNDING. Tests that care override this, distinguishing
  // "is THIS owner already on it" (where.owner_id present) from "total slots used".
  db.owner_subscriptions.count.mockImplementation(async () => 0);
  db.subscription_payments.findFirst.mockResolvedValue(null);
  db.subscription_payments.findMany.mockResolvedValue([]);
  db.subscription_invoices.findMany.mockResolvedValue([]);
});

// ── one subscription per owner ──────────────────────────────────────────────
describe("one subscription per owner", () => {
  it("returns the existing subscription without creating another", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "sub-1", owner_id: "owner-A", plan_id: "plan-starter", status: "PENDING_PAYMENT" });
    const sub = await subscriptionService.ensureForOwner("owner-A");
    expect(sub.id).toBe("sub-1");
    expect(db.owner_subscriptions.create).not.toHaveBeenCalled();
  });

  it("auto-assigns FOUNDING to a new owner while first-10 slots remain — Stayo has no trial", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue(null);
    db.owner_subscriptions.count.mockResolvedValue(3); // 3 of 10 FOUNDING slots used
    db.owner_subscriptions.create.mockImplementation(async ({ data }: any) => ({ id: "sub-new", ...data }));

    const sub = await subscriptionService.ensureForOwner("owner-B");

    expect(db.$executeRaw).toHaveBeenCalled(); // advisory lock taken in the create path
    expect(db.owner_subscriptions.create).toHaveBeenCalledTimes(1);
    const arg = db.owner_subscriptions.create.mock.calls[0][0].data;
    expect(arg.owner_id).toBe("owner-B");
    expect(arg.plan_id).toBe("plan-founding"); // first 10 owners are placed on FOUNDING
    expect(arg.status).toBe("PENDING_PAYMENT");
    expect(arg.status).not.toBe("TRIAL");
    expect(arg.trial_ends_at).toBeUndefined(); // no trial window is ever set
    expect(sub.id).toBe("sub-new");
    expect(eventLogMock.log).toHaveBeenCalledWith(
      "SUBSCRIPTION_CREATED",
      "owner-B",
      expect.objectContaining({ status: "PENDING_PAYMENT", plan_code: "FOUNDING" }),
    );
  });

  it("falls back to the STARTER placeholder once all 10 FOUNDING slots are taken", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue(null);
    db.owner_subscriptions.count.mockResolvedValue(10); // FOUNDING full
    db.owner_subscriptions.create.mockImplementation(async ({ data }: any) => ({ id: "sub-new", ...data }));

    const sub = await subscriptionService.ensureForOwner("owner-B2");

    const arg = db.owner_subscriptions.create.mock.calls[0][0].data;
    expect(arg.plan_id).toBe("plan-starter");
    expect(arg.status).toBe("PENDING_PAYMENT");
    expect(sub.id).toBe("sub-new");
    expect(eventLogMock.log).toHaveBeenCalledWith(
      "SUBSCRIPTION_CREATED",
      "owner-B2",
      expect.objectContaining({ status: "PENDING_PAYMENT", plan_code: "STARTER" }),
    );
  });

  it("recovers from a lost create race (P2002) by re-reading", async () => {
    db.owner_subscriptions.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "sub-raced", owner_id: "owner-C", plan_id: "plan-starter", status: "PENDING_PAYMENT" });
    db.owner_subscriptions.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));

    const sub = await subscriptionService.ensureForOwner("owner-C");
    expect(sub.id).toBe("sub-raced");
  });
});

// ── owner isolation ────────────────────────────────────────────────────────
describe("an owner only ever sees their own data", () => {
  it("getForOwner scopes every read to the session owner id", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "sub-1", owner_id: "owner-A", plan_id: "plan-starter", status: "PENDING_PAYMENT", pending_plan_id: null });

    await subscriptionService.getForOwner("owner-A");

    expect(db.owner_subscriptions.findUnique).toHaveBeenCalledWith({ where: { owner_id: "owner-A" } });
    expect(db.subscription_payments.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { owner_id: "owner-A" } }));
    expect(db.subscription_invoices.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { owner_id: "owner-A" } }));
  });

  it("submitPayment records the payment against the passed owner id, not the body", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "sub-1", owner_id: "owner-A", plan_id: "plan-starter", status: "PENDING_PAYMENT" });
    db.subscription_payments.create.mockImplementation(async ({ data }: any) => ({ id: "pay-1", ...data }));

    await subscriptionPaymentService.submitPayment("owner-A", {
      plan_id: "plan-starter",
      amount_paise: 149900,
      payment_method: "CASH",
    });

    const data = db.subscription_payments.create.mock.calls[0][0].data;
    expect(data.owner_id).toBe("owner-A");
    expect(db.subscription_payments.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ owner_id: "owner-A" }) }));
  });
});

// ── payment submission ─────────────────────────────────────────────────────
describe("payment submission", () => {
  beforeEach(() => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "sub-1", owner_id: "owner-A", plan_id: "plan-starter", status: "PENDING_PAYMENT" });
    db.subscription_payments.create.mockImplementation(async ({ data }: any) => ({ id: "pay-1", ...data, submitted_at: new Date() }));
  });

  it("records amount in integer paise and starts as SUBMITTED", async () => {
    const payment = await subscriptionPaymentService.submitPayment("owner-A", {
      plan_id: "plan-growth",
      amount_paise: 249900,
      payment_method: "CASH",
    });
    const data = db.subscription_payments.create.mock.calls[0][0].data;
    expect(data.amount_paise).toBe(249900);
    expect(Number.isInteger(data.amount_paise)).toBe(true);
    expect(data.status).toBe("SUBMITTED");
    expect(data.currency).toBe("INR");
    expect(data.plan_id).toBe("plan-growth");
    expect(payment.status).toBe("SUBMITTED");
    expect(eventLogMock.log).toHaveBeenCalledWith("SUBSCRIPTION_PAYMENT_SUBMITTED", "owner-A", expect.any(Object));
  });

  it("blocks a second submission while one is still awaiting review", async () => {
    db.subscription_payments.findFirst.mockResolvedValue({ id: "pay-existing" });
    await expect(
      subscriptionPaymentService.submitPayment("owner-A", { plan_id: "plan-starter", amount_paise: 149900, payment_method: "CASH" }),
    ).rejects.toMatchObject({ code: "PAYMENT_ALREADY_PENDING" });
    expect(db.subscription_payments.create).not.toHaveBeenCalled();
  });

  it("rejects GATEWAY (no gateway in Phase 2)", async () => {
    await expect(
      subscriptionPaymentService.submitPayment("owner-A", { plan_id: "plan-starter", amount_paise: 149900, payment_method: "GATEWAY" }),
    ).rejects.toMatchObject({ code: "INVALID_PAYMENT" });
  });

  it("rejects an unknown / inactive plan", async () => {
    await expect(
      subscriptionPaymentService.submitPayment("owner-A", { plan_id: "plan-nope", amount_paise: 100, payment_method: "CASH" }),
    ).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });
  });
});

// ── admin approval ─────────────────────────────────────────────────────────
describe("admin payment approval", () => {
  const submittedPayment = {
    id: "pay-1",
    owner_id: "owner-A",
    subscription_id: "sub-1",
    plan_id: "plan-starter",
    amount_paise: 149900,
    currency: "INR",
    payment_method: "CASH",
    transaction_reference: "CASH-001",
    status: "SUBMITTED",
  };

  beforeEach(() => {
    db.subscription_payments.findUnique.mockResolvedValue({ ...submittedPayment });
    db.subscription_payments.updateMany.mockResolvedValue({ count: 1 });
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "sub-1",
      owner_id: "owner-A",
      plan_id: "plan-starter",
      status: "PENDING_PAYMENT",
      started_at: null,
      current_period_start: null,
      current_period_end: null,
      pending_plan_id: null,
    });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "sub-1", owner_id: "owner-A", plan_id: "plan-starter", pending_plan_id: null, ...data }));
    db.subscription_invoices.create.mockImplementation(async ({ data }: any) => ({ id: "inv-1", ...data }));
  });

  it("activates the subscription, sets the billing period and issues an invoice — atomically", async () => {
    const result = await subscriptionPaymentService.reviewPayment({ paymentId: "pay-1", decision: "APPROVE", adminId: "admin-9" });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.subscription_payments.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "pay-1" }), data: expect.objectContaining({ status: "APPROVED", reviewed_by: "admin-9" }) }),
    );

    const subData = db.owner_subscriptions.update.mock.calls[0][0].data;
    expect(subData.status).toBe("ACTIVE");
    expect(subData.plan_id).toBe("plan-starter");
    expect(subData.current_period_start).toBeInstanceOf(Date);
    expect(subData.current_period_end).toBeInstanceOf(Date);
    expect(subData.next_renewal_at).toEqual(subData.current_period_end);
    expect(subData.trial_ends_at).toBeNull();

    const invData = db.subscription_invoices.create.mock.calls[0][0].data;
    expect(invData.payment_id).toBe("pay-1");
    expect(invData.owner_id).toBe("owner-A");
    expect(invData.amount_paise).toBe(149900); // full plan price for a NEW activation
    expect(invData.tax_paise).toBe(0); // no GST
    expect(invData.billing_period_start).toBeInstanceOf(Date);

    expect(result.kind).toBe("NEW");
    expect(result.invoice.invoice_number).toMatch(/^SUB-\d{4}-[0-9A-F]+$/);
    expect(eventLogMock.log).toHaveBeenCalledWith("SUBSCRIPTION_PAYMENT_APPROVED", "owner-A", expect.objectContaining({ kind: "NEW", invoice_id: "inv-1" }));
  });

  it("cannot approve a payment that was already reviewed (guard before the transaction)", async () => {
    db.subscription_payments.findUnique.mockResolvedValue({ ...submittedPayment, status: "APPROVED" });
    await expect(
      subscriptionPaymentService.reviewPayment({ paymentId: "pay-1", decision: "APPROVE", adminId: "admin-9" }),
    ).rejects.toMatchObject({ code: "NOT_REVIEWABLE" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("cannot double-approve under a race (the status-guarded updateMany loses)", async () => {
    db.subscription_payments.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      subscriptionPaymentService.reviewPayment({ paymentId: "pay-1", decision: "APPROVE", adminId: "admin-9" }),
    ).rejects.toMatchObject({ code: "NOT_REVIEWABLE" });
    expect(db.owner_subscriptions.update).not.toHaveBeenCalled();
    expect(db.subscription_invoices.create).not.toHaveBeenCalled();
  });
});

// ── admin rejection ────────────────────────────────────────────────────────
describe("admin payment rejection", () => {
  beforeEach(() => {
    db.subscription_payments.findUnique.mockResolvedValue({ id: "pay-1", owner_id: "owner-A", subscription_id: "sub-1", status: "SUBMITTED" });
    db.subscription_payments.updateMany.mockResolvedValue({ count: 1 });
  });

  it("marks the payment REJECTED with the reason and leaves the subscription untouched", async () => {
    const result = await subscriptionPaymentService.reviewPayment({ paymentId: "pay-1", decision: "REJECT", adminId: "admin-9", reason: "Screenshot unreadable" });

    expect(db.subscription_payments.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "REJECTED", rejection_reason: "Screenshot unreadable", reviewed_by: "admin-9" }) }),
    );
    expect(db.owner_subscriptions.update).not.toHaveBeenCalled();
    expect(db.subscription_invoices.create).not.toHaveBeenCalled();
    expect(result.payment.status).toBe("REJECTED");
    expect(eventLogMock.log).toHaveBeenCalledWith("SUBSCRIPTION_PAYMENT_REJECTED", "owner-A", expect.objectContaining({ reason: "Screenshot unreadable" }));
  });

  it("requires a rejection reason", async () => {
    await expect(
      subscriptionPaymentService.reviewPayment({ paymentId: "pay-1", decision: "REJECT", adminId: "admin-9", reason: "  " }),
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    expect(db.subscription_payments.updateMany).not.toHaveBeenCalled();
  });

  it("cannot reject an already-rejected payment", async () => {
    db.subscription_payments.findUnique.mockResolvedValue({ id: "pay-1", owner_id: "owner-A", status: "REJECTED" });
    await expect(
      subscriptionPaymentService.reviewPayment({ paymentId: "pay-1", decision: "REJECT", adminId: "admin-9", reason: "again" }),
    ).rejects.toMatchObject({ code: "NOT_REVIEWABLE" });
  });
});

// ── FOUNDING first-10 cap ──────────────────────────────────────────────────
describe("FOUNDING plan — first 10 owners only", () => {
  it("takes the advisory lock BEFORE counting slots (serialises concurrent assignment)", async () => {
    const order: string[] = [];
    db.$executeRaw.mockImplementation(async () => { order.push("lock"); return 1; });
    db.owner_subscriptions.count.mockImplementation(async () => { order.push("count"); return 0; });

    await subscriptionService.reserveFoundingSlotInTx(db, "owner-x", "plan-founding");

    expect(order[0]).toBe("lock");
    expect(order).toContain("count");
    expect(db.$executeRaw).toHaveBeenCalled();
  });

  it("allows owner #1–#10 (9 slots used → the 10th succeeds)", async () => {
    db.owner_subscriptions.count
      .mockResolvedValueOnce(0) // alreadyOn
      .mockResolvedValueOnce(9); // used
    await expect(subscriptionService.reserveFoundingSlotInTx(db, "owner-10", "plan-founding")).resolves.toBeUndefined();
  });

  it("rejects owner #11 (10 slots used)", async () => {
    db.owner_subscriptions.count
      .mockResolvedValueOnce(0) // alreadyOn
      .mockResolvedValueOnce(10); // used
    await expect(subscriptionService.reserveFoundingSlotInTx(db, "owner-11", "plan-founding")).rejects.toMatchObject({ code: "FOUNDING_FULL", status: 409 });
  });

  it("an owner already on FOUNDING renewing does not consume a new slot", async () => {
    db.owner_subscriptions.count.mockResolvedValueOnce(1); // alreadyOn > 0 → early return
    await subscriptionService.reserveFoundingSlotInTx(db, "owner-founding", "plan-founding");
    // used-count query never runs
    expect(db.owner_subscriptions.count).toHaveBeenCalledTimes(1);
  });

  it("submitPayment rejects a FOUNDING selection once the 10 slots are full", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "sub-1", owner_id: "owner-11", plan_id: "plan-starter", status: "PENDING_PAYMENT" });
    // 10 owners hold FOUNDING; this owner is not one of them.
    db.owner_subscriptions.count.mockImplementation(async ({ where }: any) => (where?.owner_id ? 0 : 10));
    await expect(
      subscriptionPaymentService.submitPayment("owner-11", { plan_id: "plan-founding", amount_paise: 200000, payment_method: "CASH" }),
    ).rejects.toMatchObject({ code: "FOUNDING_FULL" });
  });

  it("approval reserves a FOUNDING slot inside the transaction and fails the approve when full", async () => {
    db.subscription_payments.findUnique.mockResolvedValue({ id: "pay-f", owner_id: "owner-11", subscription_id: "sub-1", plan_id: "plan-founding", amount_paise: 200000, payment_method: "CASH", transaction_reference: "CASH-f", status: "SUBMITTED" });
    db.subscription_payments.updateMany.mockResolvedValue({ count: 1 });
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "sub-1", owner_id: "owner-11", plan_id: "plan-starter", status: "PENDING_PAYMENT", started_at: null, current_period_start: null, current_period_end: null, pending_plan_id: null });
    db.owner_subscriptions.count
      .mockResolvedValueOnce(0) // alreadyOn
      .mockResolvedValueOnce(10); // used → full

    await expect(
      subscriptionPaymentService.reviewPayment({ paymentId: "pay-f", decision: "APPROVE", adminId: "admin-9" }),
    ).rejects.toMatchObject({ code: "FOUNDING_FULL" });
    expect(db.$executeRaw).toHaveBeenCalled(); // advisory lock was taken
    expect(db.owner_subscriptions.update).not.toHaveBeenCalled();
  });
});

// ── FOUNDING is never owner-selectable ─────────────────────────────────────
describe("FOUNDING is auto-assigned, never listed as a choosable plan", () => {
  it("listPlansForOwner never returns FOUNDING even when slots are free", async () => {
    db.owner_subscriptions.count.mockImplementation(async ({ where }: any) => (where?.owner_id ? 0 : 3)); // 3 of 10 used
    const plans = await subscriptionService.listPlansForOwner("owner-A");
    expect(plans.find((p: any) => p.code === "FOUNDING")).toBeUndefined();
    // the normal public plans are still offered
    expect(plans.map((p: any) => p.code).sort()).toEqual(["GROWTH", "STARTER"]);
  });

  it("listPlansForOwner never returns FOUNDING when all 10 slots are taken", async () => {
    db.owner_subscriptions.count.mockImplementation(async ({ where }: any) => (where?.owner_id ? 0 : 10));
    const plans = await subscriptionService.listPlansForOwner("owner-A");
    expect(plans.find((p: any) => p.code === "FOUNDING")).toBeUndefined();
  });
});

// ── upgrade proration (service) ────────────────────────────────────────────
describe("upgrade proration", () => {
  it("previews the day-prorated difference for the rest of the period", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "sub-1",
      owner_id: "owner-A",
      plan_id: "plan-starter",
      status: "ACTIVE",
      current_period_start: new Date("2026-09-01"),
      current_period_end: new Date("2026-10-01"),
      pending_plan_id: null,
    });
    // Freeze "now" to 2026-09-19 → 12 days remain of a 30-day period.
    vi.setSystemTime(new Date("2026-09-19T09:00:00Z"));

    const preview = await subscriptionPaymentService.upgradePreview("owner-A", "plan-growth");
    // (249900 - 149900) × 12 / 30 = 40000
    expect(preview.amount_paise).toBe(40000);
    expect(preview.days_remaining).toBe(12);
    expect(preview.days_in_period).toBe(30);
    expect(preview.next_renewal_price_paise).toBe(249900);
    expect(preview.effective).toBe("IMMEDIATELY_ON_APPROVAL");
    vi.useRealTimers();
  });

  it("refuses an upgrade preview for a cheaper plan (that is a downgrade)", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "sub-1", owner_id: "owner-A", plan_id: "plan-growth", status: "ACTIVE",
      current_period_start: new Date("2026-09-01"), current_period_end: new Date("2026-10-01"), pending_plan_id: null,
    });
    await expect(subscriptionPaymentService.upgradePreview("owner-A", "plan-starter")).rejects.toMatchObject({ code: "NOT_AN_UPGRADE" });
  });
});

// ── downgrade deferred to next renewal ─────────────────────────────────────
describe("downgrade takes effect at the next renewal, not immediately", () => {
  it("planApprovalOutcome(DOWNGRADE) queues pending_plan_id and leaves the current plan + period alone", () => {
    const outcome = subscriptionPaymentService.planApprovalOutcome({
      kind: "DOWNGRADE",
      now: new Date("2026-09-19T00:00:00Z"),
      selectedPlanId: "plan-starter",
      selectedPlanPricePaise: 149900,
      paymentAmountPaise: 149900,
      pendingPlanPricePaise: null,
      subscription: {
        plan_id: "plan-growth",
        status: "ACTIVE",
        started_at: new Date("2026-08-01"),
        current_period_start: new Date("2026-09-01"),
        current_period_end: new Date("2026-10-01"),
        pending_plan_id: null,
      },
    });
    expect((outcome.data as any).pending_plan_id).toBe("plan-starter");
    expect((outcome.data as any).plan_id).toBeUndefined(); // current plan stays effective
    expect((outcome.data as any).current_period_end).toBeUndefined(); // period unchanged
    expect((outcome.data as any).status).toBeUndefined();
    expect(outcome.planChanged).toBe(false);
  });

  it("an approved DOWNGRADE payment sets pending_plan_id and issues an invoice, but keeps the current plan ACTIVE", async () => {
    db.subscription_payments.findUnique.mockResolvedValue({ id: "pay-d", owner_id: "owner-A", subscription_id: "sub-1", plan_id: "plan-starter", amount_paise: 149900, payment_method: "CASH", transaction_reference: "CASH-d", status: "SUBMITTED" });
    db.subscription_payments.updateMany.mockResolvedValue({ count: 1 });
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "sub-1", owner_id: "owner-A", plan_id: "plan-growth", status: "ACTIVE",
      started_at: new Date("2026-08-01"), current_period_start: new Date("2026-09-01"), current_period_end: new Date("2026-10-01"), pending_plan_id: null,
    });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "sub-1", owner_id: "owner-A", plan_id: "plan-growth", status: "ACTIVE", ...data }));
    db.subscription_invoices.create.mockImplementation(async ({ data }: any) => ({ id: "inv-d", ...data }));

    const result = await subscriptionPaymentService.reviewPayment({ paymentId: "pay-d", decision: "APPROVE", adminId: "admin-9" });

    expect(result.kind).toBe("DOWNGRADE");
    const subData = db.owner_subscriptions.update.mock.calls[0][0].data;
    expect(subData.pending_plan_id).toBe("plan-starter");
    expect(subData.plan_id).toBeUndefined();
    expect(db.subscription_invoices.create).toHaveBeenCalled();
    expect(eventLogMock.log).toHaveBeenCalledWith("SUBSCRIPTION_PLAN_CHANGED", "owner-A", expect.objectContaining({ effective: "NEXT_RENEWAL" }));
  });
});

// ── sanity: SubscriptionError shape ────────────────────────────────────────
describe("error typing", () => {
  it("service errors are SubscriptionError with a code + status", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "sub-1", owner_id: "owner-A", plan_id: "plan-starter", status: "PENDING_PAYMENT" });
    try {
      await subscriptionPaymentService.submitPayment("owner-A", { plan_id: "plan-starter", amount_paise: -1, payment_method: "CASH" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(isSubscriptionError(e)).toBe(true);
      expect((e as any).status).toBe(400);
    }
  });
});
