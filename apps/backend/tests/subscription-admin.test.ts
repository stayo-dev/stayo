import { readFileSync } from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const prisma: any = {
    owner_subscriptions: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(async () => []), count: vi.fn(async () => 0), groupBy: vi.fn(async () => []) },
    subscription_plans: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
    subscription_payments: { findFirst: vi.fn(async () => null), create: vi.fn(), findMany: vi.fn(async () => []), findUnique: vi.fn(), updateMany: vi.fn(), count: vi.fn(async () => 0) },
    subscription_invoices: { findMany: vi.fn(async () => []), create: vi.fn(), aggregate: vi.fn() },
    profile: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
    tenants: { count: vi.fn(async () => 0), groupBy: vi.fn(async () => []) },
    platform_settings: { findUnique: vi.fn(), upsert: vi.fn() },
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (cb: any) => cb(prisma)),
  };
  return { prisma };
});
const { eventLogMock } = vi.hoisted(() => ({ eventLogMock: { log: vi.fn(async () => undefined) } }));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: eventLogMock }));

import { prisma } from "@/lib/db";
import { subscriptionAdminService } from "@/src/services/platform-billing/subscription-admin-service";
import { subscriptionDowngradeService } from "@/src/services/platform-billing/subscription-downgrade-service";
import { subscriptionPaymentService } from "@/src/services/platform-billing/subscription-payment-service";
import { subscriptionOverrideService } from "@/src/services/platform-billing/subscription-override-service";
import { computeRenewal } from "@/src/services/platform-billing/subscription-renewal-service";

const db = prisma as any;

const PLAN: Record<string, any> = {
  STARTER: { id: "p-starter", code: "STARTER", name: "Starter", price_paise: 149900, capacity_max: 50, is_active: true },
  GROWTH: { id: "p-growth", code: "GROWTH", name: "Growth", price_paise: 249900, capacity_max: 100, is_active: true },
  FOUNDING: { id: "p-founding", code: "FOUNDING", name: "Founding", price_paise: 200000, capacity_max: null, is_active: true },
};
const BY_ID: Record<string, any> = Object.fromEntries(Object.values(PLAN).map((p) => [p.id, p]));

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (cb: any) => cb(db));
  db.$queryRaw.mockResolvedValue([]);
  db.subscription_plans.findUnique.mockImplementation(async ({ where }: any) =>
    where?.code ? PLAN[where.code] ?? null : BY_ID[where?.id] ?? null,
  );
  db.tenants.count.mockResolvedValue(0);
  db.owner_subscriptions.count.mockResolvedValue(0);
  db.subscription_payments.findFirst.mockResolvedValue(null);
});

// ── pause ─────────────────────────────────────────────────────────────────
describe("admin pause", () => {
  it("moves ACTIVE → PAUSED and audits with the admin as actor", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", status: "ACTIVE" });
    db.owner_subscriptions.update.mockResolvedValue({ id: "s1", status: "PAUSED" });
    const r = await subscriptionAdminService.pause({ subscriptionId: "s1", adminId: "admin-9", reason: "Non-payment" });
    expect(r.status).toBe("PAUSED");
    expect(db.owner_subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PAUSED" }) }),
    );
    expect(eventLogMock.log).toHaveBeenCalledWith("SUBSCRIPTION_PAUSED", "o1", expect.objectContaining({ actor: "ADMIN", admin_id: "admin-9", reason: "Non-payment" }));
  });

  it("requires a reason", async () => {
    await expect(subscriptionAdminService.pause({ subscriptionId: "s1", adminId: "a", reason: "  " })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });

  it("already PAUSED → no-op, no second write", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", status: "PAUSED" });
    const r = await subscriptionAdminService.pause({ subscriptionId: "s1", adminId: "a", reason: "x" });
    expect(r.changed).toBe(false);
    expect(db.owner_subscriptions.update).not.toHaveBeenCalled();
  });
});

// ── resume ────────────────────────────────────────────────────────────────
describe("admin resume", () => {
  it("PAUSED → PENDING_PAYMENT (a controlled step — does NOT grant paid access)", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", status: "PAUSED" });
    db.owner_subscriptions.update.mockResolvedValue({ id: "s1", status: "PENDING_PAYMENT" });
    const r = await subscriptionAdminService.resume({ subscriptionId: "s1", adminId: "a", reason: "Owner called" });
    expect(r.status).toBe("PENDING_PAYMENT");
    expect(eventLogMock.log).toHaveBeenCalledWith("SUBSCRIPTION_RESUMED", "o1", expect.any(Object));
  });

  it("refuses to resume an ACTIVE subscription", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", status: "ACTIVE" });
    await expect(subscriptionAdminService.resume({ subscriptionId: "s1", adminId: "a", reason: "x" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

// ── extend / 30-day override limit (via the existing override service) ─────
describe("admin extend", () => {
  it("30 days is allowed; 31 is refused", () => {
    const now = new Date("2026-09-15T00:00:00Z");
    expect(subscriptionOverrideService.resolveOverrideUntil({ days: 30 }, now).until.getTime()).toBe(now.getTime() + 30 * 86400000);
    expect(() => subscriptionOverrideService.resolveOverrideUntil({ days: 31 }, now)).toThrow(/30 days/);
  });

  it("setOverride requires a reason and records the admin", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", status: "PAUSED" });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", status: "PAUSED", ...data }));
    await expect(subscriptionOverrideService.setOverride({ subscriptionId: "s1", adminId: "admin-9", reason: "", days: 5 })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    const r = await subscriptionOverrideService.setOverride({ subscriptionId: "s1", adminId: "admin-9", reason: "Pay tomorrow", days: 5, now: new Date("2026-09-15T00:00:00Z") });
    expect(r.admin_override_by).toBe("admin-9");
    expect(eventLogMock.log).toHaveBeenCalledWith("SUBSCRIPTION_OVERRIDE_SET", "o1", expect.objectContaining({ admin_id: "admin-9" }));
  });
});

// ── change plan ───────────────────────────────────────────────────────────
describe("admin change plan", () => {
  it("NEXT_PERIOD just queues pending_plan_id", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", plan_id: "p-growth", status: "ACTIVE" });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", plan_id: "p-growth", pending_plan_id: null, ...data }));
    const r = await subscriptionAdminService.changePlan({ subscriptionId: "s1", adminId: "a", planId: "p-starter", effective: "NEXT_PERIOD", reason: "Owner asked" });
    expect(r.pending_plan_id).toBe("p-starter");
    expect(r.effective).toBe("NEXT_PERIOD");
  });

  it("IMMEDIATE to a smaller plan is refused when active tenants exceed the new cap", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", plan_id: "p-growth", status: "ACTIVE" });
    db.tenants.count.mockResolvedValue(70); // > STARTER's 50
    await expect(
      subscriptionAdminService.changePlan({ subscriptionId: "s1", adminId: "a", planId: "p-starter", effective: "IMMEDIATE", reason: "x" }),
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_CAPACITY_REACHED" });
  });

  it("IMMEDIATE change applies the plan and audits", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", plan_id: "p-starter", status: "ACTIVE" });
    db.tenants.count.mockResolvedValue(10);
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", pending_plan_id: null, ...data }));
    const r = await subscriptionAdminService.changePlan({ subscriptionId: "s1", adminId: "a", planId: "p-growth", effective: "IMMEDIATE", reason: "Upgrade agreed" });
    expect(r.plan_id).toBe("p-growth");
    expect(eventLogMock.log).toHaveBeenCalledWith("SUBSCRIPTION_PLAN_CHANGED", "o1", expect.objectContaining({ actor: "ADMIN", effective: "IMMEDIATE" }));
  });

  it("IMMEDIATE change to FOUNDING still runs the transaction-safe first-10 reservation", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", plan_id: "p-starter", status: "ACTIVE" });
    // reserveFoundingSlotInTx: alreadyOn = 0, used = 10 → full
    db.owner_subscriptions.count.mockResolvedValueOnce(0).mockResolvedValueOnce(10);
    await expect(
      subscriptionAdminService.changePlan({ subscriptionId: "s1", adminId: "a", planId: "p-founding", effective: "IMMEDIATE", reason: "x" }),
    ).rejects.toMatchObject({ code: "FOUNDING_FULL" });
    expect(db.$executeRaw).toHaveBeenCalled(); // advisory lock was taken
  });
});

// ── cash payment lifecycle ────────────────────────────────────────────────
describe("admin cash payment", () => {
  it("creates a SUBMITTED row (no shortcut to APPROVED) with method CASH and the admin as recorder", async () => {
    db.profile.findFirst.mockResolvedValue({ id: "o1" });
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", plan_id: "p-starter", status: "PENDING_PAYMENT" });
    db.subscription_payments.create.mockImplementation(async ({ data }: any) => ({ id: "pay-c", ...data, submitted_at: new Date() }));

    const p = await subscriptionPaymentService.recordCashPayment("admin-9", {
      ownerId: "o1",
      planId: "p-starter",
      amountPaise: 149900,
      reference: "CASH-0912",
    });

    const data = db.subscription_payments.create.mock.calls[0][0].data;
    expect(data.status).toBe("SUBMITTED");
    expect(data.payment_method).toBe("CASH");
    expect(data.transaction_reference).toBe("CASH-0912");
    expect(p.status).toBe("SUBMITTED");
    expect(eventLogMock.log).toHaveBeenCalledWith("SUBSCRIPTION_PAYMENT_SUBMITTED", "o1", expect.objectContaining({ recorded_by: "ADMIN", actor_id: "admin-9" }));
  });

  it("rejects a cash payment when the owner already has one pending", async () => {
    db.profile.findFirst.mockResolvedValue({ id: "o1" });
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", plan_id: "p-starter", status: "PENDING_PAYMENT" });
    db.subscription_payments.findFirst.mockResolvedValue({ id: "existing" });
    await expect(
      subscriptionPaymentService.recordCashPayment("admin-9", { ownerId: "o1", planId: "p-starter", amountPaise: 149900 }),
    ).rejects.toMatchObject({ code: "PAYMENT_ALREADY_PENDING" });
  });

  it("rejects a non-positive amount", async () => {
    await expect(
      subscriptionPaymentService.recordCashPayment("a", { ownerId: "o1", planId: "p-starter", amountPaise: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_PAYMENT" });
  });
});

// ── downgrade scheduling ──────────────────────────────────────────────────
describe("owner downgrade scheduling", () => {
  it("sets pending_plan_id, keeps the current plan, requires no payment", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", plan_id: "p-growth", status: "ACTIVE", current_period_end: new Date("2026-10-01"),
    });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", status: "ACTIVE", current_period_end: new Date("2026-10-01"), ...data }));

    const r = await subscriptionDowngradeService.scheduleDowngrade("o1", "p-starter");
    expect(r.pending_plan.code).toBe("STARTER");
    expect(r.current_plan.code).toBe("GROWTH");
    const data = db.owner_subscriptions.update.mock.calls[0][0].data;
    expect(data.pending_plan_id).toBe("p-starter");
    expect(data.plan_id).toBeUndefined(); // current plan untouched
    expect(db.subscription_payments.create).not.toHaveBeenCalled();
    expect(eventLogMock.log).toHaveBeenCalledWith("SUBSCRIPTION_DOWNGRADE_SCHEDULED", "o1", expect.objectContaining({ to_plan: "STARTER", effective: "NEXT_RENEWAL" }));
  });

  it("refuses a more-expensive target (that is an upgrade)", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", plan_id: "p-starter", status: "ACTIVE", current_period_end: new Date() });
    await expect(subscriptionDowngradeService.scheduleDowngrade("o1", "p-growth")).rejects.toMatchObject({ code: "NOT_A_DOWNGRADE" });
  });

  it("refuses when the subscription is not ACTIVE", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", plan_id: "p-growth", status: "PAUSED", current_period_end: new Date() });
    await expect(subscriptionDowngradeService.scheduleDowngrade("o1", "p-starter")).rejects.toMatchObject({ code: "NOT_ACTIVE" });
  });

  it("cancel clears pending_plan_id", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", plan_id: "p-growth", status: "ACTIVE", pending_plan_id: "p-starter" });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", status: "ACTIVE", ...data }));
    const r = await subscriptionDowngradeService.cancelPendingDowngrade("o1");
    expect(r.pending_plan).toBeNull();
    expect(db.owner_subscriptions.update.mock.calls[0][0].data.pending_plan_id).toBeNull();
    expect(eventLogMock.log).toHaveBeenCalledWith("SUBSCRIPTION_DOWNGRADE_CANCELLED", "o1", expect.any(Object));
  });

  it("cancel with nothing scheduled → NO_PENDING_CHANGE", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", plan_id: "p-growth", status: "ACTIVE", pending_plan_id: null });
    await expect(subscriptionDowngradeService.cancelPendingDowngrade("o1")).rejects.toMatchObject({ code: "NO_PENDING_CHANGE" });
  });
});

// ── downgrade applied at renewal (Phase 3 logic, unchanged) ───────────────
describe("a scheduled downgrade is applied by the renewal, at the new plan's full price", () => {
  it("computeRenewal switches to the pending plan and clears it", () => {
    const out = computeRenewal({
      now: new Date("2026-10-05T00:00:00Z"),
      currentStatus: "ACTIVE",
      currentPeriodEnd: new Date("2026-10-10"),
      pendingPlanId: "p-starter",
      pendingPlanPricePaise: 149900,
      paymentPlanId: "p-growth",
      paymentPlanPricePaise: 249900,
    });
    expect(out.effective_plan_id).toBe("p-starter");
    expect(out.full_price_paise).toBe(149900); // STARTER full price, not prorated
    expect(out.cleared_pending).toBe(true);
  });
});

// ── route authorization (admin mutations must gate on requireAdmin) ───────
describe("admin billing routes are behind requireAdmin", () => {
  const read = (rel: string) => readFileSync(path.join(__dirname, "..", rel), "utf8");
  it.each([
    "app/api/platform-admin/subscriptions/route.ts",
    "app/api/platform-admin/subscriptions/[id]/route.ts",
    "app/api/platform-admin/subscriptions/[id]/pause/route.ts",
    "app/api/platform-admin/subscriptions/[id]/resume/route.ts",
    "app/api/platform-admin/subscriptions/[id]/change-plan/route.ts",
    "app/api/platform-admin/subscriptions/[id]/override/route.ts",
    "app/api/platform-admin/subscription-payments/route.ts",
    "app/api/platform-admin/subscription-payments/[id]/approve/route.ts",
    "app/api/platform-admin/subscription-payments/[id]/reject/route.ts",
    "app/api/platform-admin/subscription-payments/cash/route.ts",
    "app/api/platform-admin/billing-settings/route.ts",
    "app/api/platform-admin/billing-settings/qr/route.ts",
    "app/api/platform-admin/revenue/route.ts",
  ])("%s calls requireAdmin", (rel) => {
    expect(read(rel)).toMatch(/requireAdmin\(/);
  });

  it("the owner downgrade route is owner-scoped, never admin", () => {
    const src = read("app/api/owner/subscription/downgrade/route.ts");
    expect(src).toMatch(/resolveOwnerId\(session\)/);
    expect(src).not.toMatch(/requireAdmin/);
  });
});

// ── FOUNDING is shown/handled without a 50-tenant limit ───────────────────
describe("FOUNDING admin handling", () => {
  it("listSubscriptions reports Unlimited (capacity_max null) for a FOUNDING owner", async () => {
    db.owner_subscriptions.findMany.mockResolvedValue([
      { id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: "p-founding", current_period_end: null, next_renewal_at: null, admin_override_until: null,
        profile: { id: "o1", name: "F Owner", email: "f@x", phone: "" },
        subscription_plans: { code: "FOUNDING", name: "Founding", price_paise: 200000, capacity_max: null },
        pending_plan: null },
    ]);
    db.owner_subscriptions.count.mockResolvedValue(1);
    db.owner_subscriptions.groupBy.mockResolvedValue([{ status: "ACTIVE", _count: { _all: 1 } }]);
    db.tenants.groupBy.mockResolvedValue([{ owner_id: "o1", _count: { _all: 5000 } }]);
    db.subscription_payments.findMany.mockResolvedValue([]);

    const r = await subscriptionAdminService.listSubscriptions({});
    const row = r.subscriptions[0];
    expect(row.usage.capacity_max).toBeNull();
    expect(row.usage.at_limit).toBe(false); // unlimited — never "at limit"
  });
});
