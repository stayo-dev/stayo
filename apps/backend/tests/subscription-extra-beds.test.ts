/**
 * Updated Stayo subscription capacity model — included beds + paid extra
 * beds (business rules, 2026-09-10):
 *
 *   FOUNDING     250 included, unlimited extra beds @ ₹10/bed, no ceiling
 *   STARTER       50 included, up to  10 extra beds @ ₹10/bed
 *   GROWTH       100 included, up to  25 extra beds @ ₹10/bed
 *   PROFESSIONAL 250 included, up to  50 extra beds @ ₹10/bed
 *   PORTFOLIO    500 included, extra beds NOT offered (max_extra_beds: 0 —
 *                explicit "unresolved business value", never invented)
 *
 * Covers: pure rules (capacity/pricing/validation), server-side extra-bed
 * validation on submit + at approval, capacity enforcement using
 * included+extra (not the plan's theoretical max), FOUNDING's no-ceiling,
 * Portfolio's not-offered block, and admin change-plan.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyPlanChange,
  computePlanTotalPaise,
  effectivePlanCapacity,
  validateExtraBeds,
} from "@/src/services/platform-billing/subscription-rules";

// ── plan fixtures, matching the seeded catalogue ────────────────────────────
const FOUNDING = { id: "p-founding", code: "FOUNDING", price_paise: 200000, included_beds: 250, max_extra_beds: null, extra_bed_price_paise: 1000, is_active: true };
const STARTER = { id: "p-starter", code: "STARTER", price_paise: 149900, included_beds: 50, max_extra_beds: 10, extra_bed_price_paise: 1000, is_active: true };
const GROWTH = { id: "p-growth", code: "GROWTH", price_paise: 249900, included_beds: 100, max_extra_beds: 25, extra_bed_price_paise: 1000, is_active: true };
const PROFESSIONAL = { id: "p-pro", code: "PROFESSIONAL", price_paise: 449900, included_beds: 250, max_extra_beds: 50, extra_bed_price_paise: 1000, is_active: true };
const PORTFOLIO = { id: "p-portfolio", code: "PORTFOLIO", price_paise: 799900, included_beds: 500, max_extra_beds: 0, extra_bed_price_paise: null, is_active: true };
const PLAN_BY_ID: Record<string, any> = { [FOUNDING.id]: FOUNDING, [STARTER.id]: STARTER, [GROWTH.id]: GROWTH, [PROFESSIONAL.id]: PROFESSIONAL, [PORTFOLIO.id]: PORTFOLIO };

describe("effectivePlanCapacity — pure", () => {
  it("FOUNDING has no ceiling regardless of extra_beds", () => {
    expect(effectivePlanCapacity(FOUNDING, 0)).toBeNull();
    expect(effectivePlanCapacity(FOUNDING, 10_000)).toBeNull();
  });

  it("STARTER: included + extra_beds, capped at max_extra_beds", () => {
    expect(effectivePlanCapacity(STARTER, 0)).toBe(50);
    expect(effectivePlanCapacity(STARTER, 5)).toBe(55);
    expect(effectivePlanCapacity(STARTER, 10)).toBe(60);
    expect(effectivePlanCapacity(STARTER, 999)).toBe(60); // defensive cap, never overshoots
  });

  it("PORTFOLIO: extra beds not offered — capacity never moves past included_beds", () => {
    expect(effectivePlanCapacity(PORTFOLIO, 0)).toBe(500);
    expect(effectivePlanCapacity(PORTFOLIO, 50)).toBe(500);
  });
});

describe("validateExtraBeds — pure, server-side allowance check", () => {
  it("rejects a non-integer or negative count", () => {
    expect(validateExtraBeds(STARTER, -1).ok).toBe(false);
    expect(validateExtraBeds(STARTER, 1.5).ok).toBe(false);
  });

  it("0 is always fine, on every plan including Portfolio", () => {
    expect(validateExtraBeds(PORTFOLIO, 0)).toEqual({ ok: true });
    expect(validateExtraBeds(FOUNDING, 0)).toEqual({ ok: true });
  });

  it("STARTER: within 10 is fine, 11 is refused with an upgrade nudge", () => {
    expect(validateExtraBeds(STARTER, 10).ok).toBe(true);
    const r = validateExtraBeds(STARTER, 11);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/at most 10 extra beds.*[Uu]pgrade/);
  });

  it("GROWTH: within 25 is fine, 26 is refused", () => {
    expect(validateExtraBeds(GROWTH, 25).ok).toBe(true);
    expect(validateExtraBeds(GROWTH, 26).ok).toBe(false);
  });

  it("PROFESSIONAL: within 50 is fine, 51 is refused", () => {
    expect(validateExtraBeds(PROFESSIONAL, 50).ok).toBe(true);
    expect(validateExtraBeds(PROFESSIONAL, 51).ok).toBe(false);
  });

  it("FOUNDING: any positive count is fine — no ceiling", () => {
    expect(validateExtraBeds(FOUNDING, 1).ok).toBe(true);
    expect(validateExtraBeds(FOUNDING, 100_000).ok).toBe(true);
  });

  it("PORTFOLIO: any positive count is refused — extra beds not offered, distinct message from an allowance limit", () => {
    const r = validateExtraBeds(PORTFOLIO, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not available on this plan/);
  });

  it("a plan with no max_extra_beds set at all behaves like Portfolio (not unlimited by accident)", () => {
    const legacyPlan = { included_beds: 50, max_extra_beds: undefined as any, extra_bed_price_paise: undefined as any };
    expect(validateExtraBeds(legacyPlan, 0)).toEqual({ ok: true });
    expect(validateExtraBeds(legacyPlan, 1).ok).toBe(false);
  });
});

describe("computePlanTotalPaise — pure, integer paise only", () => {
  it("plan price + extra beds × per-bed price", () => {
    expect(computePlanTotalPaise(STARTER, 0)).toBe(149900);
    expect(computePlanTotalPaise(STARTER, 10)).toBe(149900 + 10 * 1000);
    expect(computePlanTotalPaise(FOUNDING, 500)).toBe(200000 + 500 * 1000);
  });

  it("a plan with no extra_bed_price_paise (Portfolio) contributes 0 regardless of extraBeds", () => {
    expect(computePlanTotalPaise(PORTFOLIO, 0)).toBe(799900);
  });
});

describe("classifyPlanChange — EXTRA_BEDS kind (additive to the existing four)", () => {
  const base = {
    currentStatus: "ACTIVE" as const,
    currentPlanPricePaise: 149900,
    selectedPlanPricePaise: 149900,
    selectedPlanId: "p-starter",
    currentPlanId: "p-starter",
  };

  it("same plan, more extra beds than currently active → EXTRA_BEDS", () => {
    expect(classifyPlanChange({ ...base, currentExtraBeds: 2, requestedExtraBeds: 5 })).toBe("EXTRA_BEDS");
  });

  it("same plan, same or fewer extra beds → still RENEWAL (unchanged behaviour)", () => {
    expect(classifyPlanChange({ ...base, currentExtraBeds: 5, requestedExtraBeds: 5 })).toBe("RENEWAL");
    expect(classifyPlanChange({ ...base, currentExtraBeds: 5, requestedExtraBeds: 2 })).toBe("RENEWAL");
  });

  it("same plan with no extra-bed params at all → still RENEWAL (existing callers unaffected)", () => {
    expect(classifyPlanChange(base)).toBe("RENEWAL");
  });

  it("a genuine plan upgrade is unaffected by extra-bed params", () => {
    expect(
      classifyPlanChange({ ...base, selectedPlanId: "p-growth", selectedPlanPricePaise: 249900, currentExtraBeds: 0, requestedExtraBeds: 0 }),
    ).toBe("UPGRADE");
  });
});

// ── integration: plan-capacity-service, subscriptionPaymentService, subscriptionAdminService ──
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
import { planCapacityService } from "@/src/services/platform-billing/plan-capacity-service";
import { subscriptionPaymentService } from "@/src/services/platform-billing/subscription-payment-service";
import { subscriptionAdminService } from "@/src/services/platform-billing/subscription-admin-service";

const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (cb: any) => cb(db));
  db.$queryRaw.mockResolvedValue([]);
  db.subscription_plans.findUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id) return PLAN_BY_ID[where.id] ?? null;
    if (where?.code) {
      const byCode: Record<string, any> = {
        FOUNDING, STARTER, GROWTH, PROFESSIONAL, PORTFOLIO,
      };
      return byCode[where.code] ?? null;
    }
    return null;
  });
  db.subscription_payments.findFirst.mockResolvedValue(null);
  db.owner_subscriptions.count.mockResolvedValue(0);
  db.tenants.count.mockResolvedValue(0);
});

describe("plan-capacity-service.getCapacityStatus — uses included_beds + the owner's extra_beds", () => {
  it("STARTER owner with 3 paid extra beds has a ceiling of 53, not 50 or 60", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ plan_id: STARTER.id, extra_beds: 3 });
    db.tenants.count.mockResolvedValue(52);
    const status = await planCapacityService.getCapacityStatus("owner-1");
    expect(status.capacity_max).toBe(53);
    expect(status.at_limit).toBe(false);
    db.tenants.count.mockResolvedValue(53);
    const status2 = await planCapacityService.getCapacityStatus("owner-1");
    expect(status2.at_limit).toBe(true);
  });

  it("FOUNDING owner is unlimited no matter how many extra beds they've bought", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ plan_id: FOUNDING.id, extra_beds: 400 });
    db.tenants.count.mockResolvedValue(650);
    const status = await planCapacityService.getCapacityStatus("owner-founding");
    expect(status.capacity_max).toBeNull();
    expect(status.at_limit).toBe(false);
  });

  it("PORTFOLIO owner's ceiling stays at included_beds (500) — no extra beds can be bought to move it", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ plan_id: PORTFOLIO.id, extra_beds: 0 });
    db.tenants.count.mockResolvedValue(500);
    const status = await planCapacityService.getCapacityStatus("owner-portfolio");
    expect(status.capacity_max).toBe(500);
    expect(status.at_limit).toBe(true);
  });
});

describe("subscriptionPaymentService.submitPayment — server-side extra-bed validation", () => {
  it("rejects extra_beds beyond STARTER's allowance of 10, even with a matching amount_paise", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", status: "PENDING_PAYMENT", plan_id: STARTER.id, extra_beds: 0 });
    await expect(
      subscriptionPaymentService.submitPayment("o1", {
        plan_id: STARTER.id,
        amount_paise: 149900 + 11_000,
        payment_method: "CASH",
        extra_beds: 11,
      }),
    ).rejects.toMatchObject({ code: "EXTRA_BEDS_LIMIT_EXCEEDED" });
    expect(db.subscription_payments.create).not.toHaveBeenCalled();
  });

  it("accepts extra_beds within the allowance and stores it on the payment row", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", status: "PENDING_PAYMENT", plan_id: STARTER.id, extra_beds: 0 });
    db.subscription_payments.create.mockResolvedValue({ id: "pay-1", extra_beds: 5 });
    await subscriptionPaymentService.submitPayment("o1", { plan_id: STARTER.id, amount_paise: 154900, payment_method: "CASH", extra_beds: 5 });
    expect(db.subscription_payments.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ extra_beds: 5 }) }),
    );
  });

  it("Portfolio owners cannot submit any extra beds — 'not available', not a numeric ceiling", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s2", owner_id: "o2", status: "PENDING_PAYMENT", plan_id: PORTFOLIO.id, extra_beds: 0 });
    const err: any = await subscriptionPaymentService
      .submitPayment("o2", { plan_id: PORTFOLIO.id, amount_paise: 799900, payment_method: "CASH", extra_beds: 1 })
      .catch((e: any) => e);
    expect(err.code).toBe("EXTRA_BEDS_LIMIT_EXCEEDED");
    expect(err.message).toMatch(/not available on this plan/);
  });

  it("FOUNDING owners may request a very large extra-bed count — no ceiling", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s3", owner_id: "o3", status: "PENDING_PAYMENT", plan_id: FOUNDING.id, extra_beds: 0 });
    db.subscription_payments.create.mockResolvedValue({ id: "pay-f", extra_beds: 300 });
    await subscriptionPaymentService.submitPayment("o3", { plan_id: FOUNDING.id, amount_paise: 200000 + 300_000, payment_method: "CASH", extra_beds: 300 });
    expect(db.subscription_payments.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ extra_beds: 300 }) }),
    );
  });
});

describe("subscriptionPaymentService.reviewPayment — approval sets owner_subscriptions.extra_beds", () => {
  it("UPGRADE approval sets extra_beds to the payment's requested count and records it on the invoice", async () => {
    db.subscription_payments.findUnique.mockResolvedValue({
      id: "pay-u", owner_id: "o1", subscription_id: "s1", plan_id: GROWTH.id, amount_paise: 300000, extra_beds: 8, payment_method: "CASH", status: "SUBMITTED",
    });
    db.subscription_payments.updateMany.mockResolvedValue({ count: 1 });
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: STARTER.id, extra_beds: 0, pending_plan_id: null,
      started_at: new Date(), current_period_start: new Date("2026-09-01"), current_period_end: new Date("2026-10-01"),
    });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", ...data }));
    db.subscription_invoices.create.mockImplementation(async ({ data }: any) => ({ id: "inv-1", invoice_number: "SUB-2026-X", ...data }));

    await subscriptionPaymentService.reviewPayment({ paymentId: "pay-u", decision: "APPROVE", adminId: "admin-1" });

    expect(db.owner_subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ plan_id: GROWTH.id, extra_beds: 8 }) }),
    );
    expect(db.subscription_invoices.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ extra_beds: 8 }) }),
    );
  });

  it("DOWNGRADE approval never touches extra_beds — it's queued for the later renewal payment", async () => {
    db.subscription_payments.findUnique.mockResolvedValue({
      id: "pay-d", owner_id: "o1", subscription_id: "s1", plan_id: STARTER.id, amount_paise: 149900, extra_beds: 0, payment_method: "CASH", status: "SUBMITTED",
    });
    db.subscription_payments.updateMany.mockResolvedValue({ count: 1 });
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: GROWTH.id, extra_beds: 5, pending_plan_id: null,
      started_at: new Date(), current_period_start: new Date("2026-09-01"), current_period_end: new Date("2026-10-01"),
    });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", ...data }));
    db.subscription_invoices.create.mockImplementation(async ({ data }: any) => ({ id: "inv-2", invoice_number: "SUB-2026-Y", ...data }));

    await subscriptionPaymentService.reviewPayment({ paymentId: "pay-d", decision: "APPROVE", adminId: "admin-1" });

    const updateCall = db.owner_subscriptions.update.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty("extra_beds"); // current plan + its extra beds stay untouched
    expect(updateCall.data.pending_plan_id).toBe(STARTER.id);
  });

  it("EXTRA_BEDS approval (same plan, more beds) is immediate and never resets the billing period", async () => {
    db.subscription_payments.findUnique.mockResolvedValue({
      id: "pay-e", owner_id: "o1", subscription_id: "s1", plan_id: STARTER.id, amount_paise: 3000, extra_beds: 3, payment_method: "CASH", status: "SUBMITTED",
    });
    db.subscription_payments.updateMany.mockResolvedValue({ count: 1 });
    const periodStart = new Date("2026-09-01");
    const periodEnd = new Date("2026-10-01");
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "s1", owner_id: "o1", status: "ACTIVE", plan_id: STARTER.id, extra_beds: 0, pending_plan_id: null,
      started_at: new Date("2026-06-01"), current_period_start: periodStart, current_period_end: periodEnd,
    });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", ...data }));
    db.subscription_invoices.create.mockImplementation(async ({ data }: any) => ({ id: "inv-3", invoice_number: "SUB-2026-Z", ...data }));

    await subscriptionPaymentService.reviewPayment({ paymentId: "pay-e", decision: "APPROVE", adminId: "admin-1" });

    const updateCall = db.owner_subscriptions.update.mock.calls[0][0];
    expect(updateCall.data.extra_beds).toBe(3);
    expect(updateCall.data.plan_id).toBeUndefined(); // same plan — never rewritten
    expect(updateCall.data.current_period_start).toBeUndefined(); // period untouched, unlike a renewal
  });
});

describe("subscriptionAdminService.changePlan — extra_beds validated + factored into the capacity check", () => {
  it("IMMEDIATE change refuses when active tenants exceed included_beds + requested extra_beds", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", plan_id: STARTER.id, status: "ACTIVE" });
    db.tenants.count.mockResolvedValue(55); // needs 5 extra beds to fit on STARTER's 50 included
    await expect(
      subscriptionAdminService.changePlan({ subscriptionId: "s1", adminId: "a", planId: STARTER.id, effective: "IMMEDIATE", reason: "x", extraBeds: 3 }),
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_CAPACITY_REACHED" });
  });

  it("IMMEDIATE change succeeds and sets extra_beds when enough extra beds are requested", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", plan_id: GROWTH.id, status: "ACTIVE" });
    db.tenants.count.mockResolvedValue(55);
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", ...data }));
    const r = await subscriptionAdminService.changePlan({ subscriptionId: "s1", adminId: "a", planId: STARTER.id, effective: "IMMEDIATE", reason: "x", extraBeds: 5 });
    expect(r.extra_beds).toBe(5);
    expect(db.owner_subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ extra_beds: 5 }) }),
    );
  });

  it("refuses extra_beds beyond the new plan's allowance", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", plan_id: GROWTH.id, status: "ACTIVE" });
    await expect(
      subscriptionAdminService.changePlan({ subscriptionId: "s1", adminId: "a", planId: STARTER.id, effective: "IMMEDIATE", reason: "x", extraBeds: 11 }),
    ).rejects.toMatchObject({ code: "EXTRA_BEDS_LIMIT_EXCEEDED" });
  });

  it("omitting extra_beds on an IMMEDIATE change defaults to 0 — never silently carries over the old value", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "s1", owner_id: "o1", plan_id: GROWTH.id, status: "ACTIVE" });
    db.tenants.count.mockResolvedValue(10);
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "s1", ...data }));
    const r = await subscriptionAdminService.changePlan({ subscriptionId: "s1", adminId: "a", planId: STARTER.id, effective: "IMMEDIATE", reason: "x" });
    expect(r.extra_beds).toBe(0);
  });
});
