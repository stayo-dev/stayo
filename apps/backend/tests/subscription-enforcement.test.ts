import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const prisma: any = {
    owner_subscriptions: { findUnique: vi.fn() },
    subscription_plans: { findUnique: vi.fn() },
    tenants: { count: vi.fn() },
    $queryRaw: vi.fn(async () => []),
  };
  return { prisma };
});
const { eventLogMock } = vi.hoisted(() => ({ eventLogMock: { log: vi.fn(async () => undefined) } }));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: eventLogMock }));

import { prisma } from "@/lib/db";
import {
  decideSubscriptionAccess,
  requireActiveSubscription,
} from "@/src/services/platform-billing/subscription-access-service";
import {
  evaluateCapacity,
  planCapacityService,
} from "@/src/services/platform-billing/plan-capacity-service";
import { subscriptionOverrideService } from "@/src/services/platform-billing/subscription-override-service";

const db = prisma as any;
const NOW = new Date("2026-09-15T12:00:00Z");

function setEnforced(on: boolean) {
  if (on) process.env.PLATFORM_BILLING_ENFORCED = "true";
  else delete process.env.PLATFORM_BILLING_ENFORCED;
}

beforeEach(() => {
  vi.clearAllMocks();
  setEnforced(true);
  db.$queryRaw.mockResolvedValue([]);
});
afterEach(() => setEnforced(false));

// ── decideSubscriptionAccess (pure) ────────────────────────────────────────
describe("decideSubscriptionAccess", () => {
  it("ACTIVE → allowed", () => {
    expect(decideSubscriptionAccess({ status: "ACTIVE", admin_override_until: null }, NOW).allowed).toBe(true);
  });
  it("PENDING_PAYMENT / PAUSED / CANCELLED / EXPIRED / TRIAL → blocked", () => {
    for (const status of ["PENDING_PAYMENT", "PAUSED", "CANCELLED", "EXPIRED", "TRIAL"]) {
      expect(decideSubscriptionAccess({ status, admin_override_until: null }, NOW).allowed).toBe(false);
    }
  });
  it("missing subscription → blocked (NO_SUBSCRIPTION)", () => {
    const d = decideSubscriptionAccess(null, NOW);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("NO_SUBSCRIPTION");
  });
  it("a valid admin override lets a PAUSED subscription through", () => {
    const future = new Date(NOW.getTime() + 5 * 86400000);
    const d = decideSubscriptionAccess({ status: "PAUSED", admin_override_until: future }, NOW);
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("ADMIN_OVERRIDE");
  });
  it("an EXPIRED admin override no longer grants access", () => {
    const past = new Date(NOW.getTime() - 60000);
    expect(decideSubscriptionAccess({ status: "PAUSED", admin_override_until: past }, NOW).allowed).toBe(false);
  });
  it("an override never resurrects a CANCELLED subscription", () => {
    const future = new Date(NOW.getTime() + 5 * 86400000);
    expect(decideSubscriptionAccess({ status: "CANCELLED", admin_override_until: future }, NOW).allowed).toBe(false);
  });
});

// ── requireActiveSubscription (enforced) ───────────────────────────────────
describe("requireActiveSubscription (PLATFORM_BILLING_ENFORCED=true)", () => {
  it("allows an ACTIVE owner", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ status: "ACTIVE", admin_override_until: null });
    await expect(requireActiveSubscription("owner-A", { now: NOW })).resolves.toMatchObject({ allowed: true });
  });
  it("blocks a PAUSED owner with 402 SUBSCRIPTION_INACTIVE", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ status: "PAUSED", admin_override_until: null });
    await expect(requireActiveSubscription("owner-A", { now: NOW })).rejects.toMatchObject({
      code: "SUBSCRIPTION_INACTIVE",
      status: 402,
    });
  });
  it("blocks an owner with no subscription", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue(null);
    await expect(requireActiveSubscription("owner-A", { now: NOW })).rejects.toMatchObject({ code: "SUBSCRIPTION_INACTIVE" });
  });
  it("blocks a legacy TRIAL owner", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ status: "TRIAL", admin_override_until: null });
    await expect(requireActiveSubscription("owner-A", { now: NOW })).rejects.toMatchObject({ code: "SUBSCRIPTION_INACTIVE" });
  });
});

describe("requireActiveSubscription (warn-only, flag off)", () => {
  beforeEach(() => setEnforced(false));
  it("does NOT throw for a blocked owner — logs and allows", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ status: "PAUSED", admin_override_until: null });
    const decision = await requireActiveSubscription("owner-A", { now: NOW });
    expect(decision.allowed).toBe(false);
    expect(eventLogMock.log).toHaveBeenCalledWith("SUBSCRIPTION_ENFORCEMENT_SKIPPED", "owner-A", expect.any(Object));
  });
});

// ── evaluateCapacity (pure) ────────────────────────────────────────────────
describe("evaluateCapacity", () => {
  it("null capacity (FOUNDING) is always allowed", () => {
    expect(evaluateCapacity({ capacityMax: null, activeCountExcludingTarget: 9999 }).allowed).toBe(true);
  });
  it("allows when there is room (others < max)", () => {
    expect(evaluateCapacity({ capacityMax: 50, activeCountExcludingTarget: 49 }).allowed).toBe(true);
  });
  it("blocks at the ceiling (others >= max)", () => {
    expect(evaluateCapacity({ capacityMax: 50, activeCountExcludingTarget: 50 }).allowed).toBe(false);
    expect(evaluateCapacity({ capacityMax: 50, activeCountExcludingTarget: 51 }).allowed).toBe(false);
  });
});

// ── planCapacityService.assertCanActivate (enforced) ───────────────────────
describe("planCapacityService.assertCanActivate", () => {
  const tx = () => {
    const t: any = {
      $queryRaw: vi.fn(async () => []),
      owner_subscriptions: { findUnique: vi.fn() },
      subscription_plans: { findUnique: vi.fn() },
      tenants: { count: vi.fn() },
    };
    return t;
  };

  function wire(t: any, planCode: string, capacityMax: number | null, activeCount: number) {
    t.owner_subscriptions.findUnique.mockImplementation(async ({ select }: any) =>
      select?.status !== undefined
        ? { status: "ACTIVE", admin_override_until: null }
        : { plan_id: "plan-x", extra_beds: 0 },
    );
    t.subscription_plans.findUnique.mockResolvedValue({ code: planCode, capacity_max: capacityMax });
    t.tenants.count.mockResolvedValue(activeCount);
  }

  it("legacy plan with no included_beds set falls back to the raw capacity_max — always allowed when that's null", async () => {
    const t = tx();
    wire(t, "LEGACY", null, 5000);
    const status = await planCapacityService.assertCanActivate("owner-A", { tx: t });
    expect(status.capacity_max).toBeNull();
    expect(t.tenants.count).not.toHaveBeenCalled();
  });

  it("FOUNDING never blocks activation — no hard maximum (business rules, 2026-09-12: usage bills, it never gates)", async () => {
    const t = tx();
    t.owner_subscriptions.findUnique.mockImplementation(async ({ select }: any) =>
      select?.status !== undefined
        ? { status: "ACTIVE", admin_override_until: null }
        : { plan_id: "plan-founding", extra_beds: 0 },
    );
    t.subscription_plans.findUnique.mockResolvedValue({ code: "FOUNDING", capacity_max: null, included_beds: 250, max_extra_beds: null, extra_bed_price_paise: 1000 });
    t.tenants.count.mockResolvedValue(500); // way past 250 — still allowed

    const status = await planCapacityService.assertCanActivate("owner-A", { tx: t });
    expect(status.capacity_max).toBeNull();
    expect(status.at_limit).toBe(false);
    // The gate short-circuits before ever counting active tenants — same as
    // the legacy-null-capacity case above.
    expect(t.tenants.count).not.toHaveBeenCalled();
  });

  it("FOUNDING is never blocked regardless of the subscription's stored extra_beds (that field no longer feeds the gate)", async () => {
    const t = tx();
    t.owner_subscriptions.findUnique.mockImplementation(async ({ select }: any) =>
      select?.status !== undefined
        ? { status: "ACTIVE", admin_override_until: null }
        : { plan_id: "plan-founding", extra_beds: 50 },
    );
    t.subscription_plans.findUnique.mockResolvedValue({ code: "FOUNDING", capacity_max: null, included_beds: 250, max_extra_beds: null, extra_bed_price_paise: 1000 });
    t.tenants.count.mockResolvedValue(9999);

    const status = await planCapacityService.assertCanActivate("owner-A", { tx: t });
    expect(status.capacity_max).toBeNull();
    expect(status.at_limit).toBe(false);
  });

  it.each([
    ["STARTER", 50],
    ["GROWTH", 100],
    ["PROFESSIONAL", 250],
    ["PORTFOLIO", 500],
  ] as const)("%s blocks at %d active tenants", async (code, cap) => {
    const t = tx();
    wire(t, code, cap, cap); // already at the ceiling
    await expect(planCapacityService.assertCanActivate("owner-A", { tx: t })).rejects.toMatchObject({
      code: "SUBSCRIPTION_CAPACITY_REACHED",
      status: 409,
      details: { current: cap, capacity: cap, plan: code },
    });
  });

  it("STARTER allows the 50th activation (49 others)", async () => {
    const t = tx();
    wire(t, "STARTER", 50, 49);
    await expect(planCapacityService.assertCanActivate("owner-A", { tx: t })).resolves.toMatchObject({ at_limit: false });
  });

  it("takes the FOR UPDATE row lock BEFORE counting (serialises concurrent activations)", async () => {
    const t = tx();
    wire(t, "STARTER", 50, 10);
    const order: string[] = [];
    t.$queryRaw.mockImplementation(async () => { order.push("lock"); return []; });
    t.tenants.count.mockImplementation(async () => { order.push("count"); return 10; });
    await planCapacityService.assertCanActivate("owner-A", { tx: t });
    expect(order[0]).toBe("lock");
    expect(order).toContain("count");
  });

  it("excludes the tenant being (re)activated from the count — a no-op re-activation is not blocked", async () => {
    const t = tx();
    wire(t, "STARTER", 50, 50);
    // 50 total ACTIVE, but the target tenant is one of them → 49 others → allowed
    t.tenants.count.mockImplementation(async ({ where }: any) => (where?.id?.not ? 49 : 50));
    await expect(
      planCapacityService.assertCanActivate("owner-A", { tx: t, tenantId: "tenant-1" }),
    ).resolves.toMatchObject({ at_limit: false });
  });

  it("isRenewal skips the capacity ceiling (net-zero) but still requires an active subscription", async () => {
    const t = tx();
    wire(t, "STARTER", 50, 999);
    await expect(planCapacityService.assertCanActivate("owner-A", { tx: t, isRenewal: true })).resolves.toBeTruthy();
  });

  it("still enforces requireActiveSubscription for a PAUSED owner", async () => {
    const t = tx();
    t.owner_subscriptions.findUnique.mockImplementation(async ({ select }: any) =>
      select?.status !== undefined ? { status: "PAUSED", admin_override_until: null } : { plan_id: "plan-x" },
    );
    await expect(planCapacityService.assertCanActivate("owner-A", { tx: t })).rejects.toMatchObject({
      code: "SUBSCRIPTION_INACTIVE",
    });
  });

  it("warn-only: at the ceiling it logs and resolves instead of throwing", async () => {
    setEnforced(false);
    const t = tx();
    wire(t, "STARTER", 50, 50);
    await expect(planCapacityService.assertCanActivate("owner-A", { tx: t })).resolves.toBeTruthy();
    expect(eventLogMock.log).toHaveBeenCalledWith(
      "SUBSCRIPTION_ENFORCEMENT_SKIPPED",
      "owner-A",
      expect.objectContaining({ reason: "SUBSCRIPTION_CAPACITY_REACHED" }),
    );
  });
});

// ── admin override ────────────────────────────────────────────────────────
describe("subscriptionOverrideService.resolveOverrideUntil", () => {
  it("caps a day-based override at 30 days", () => {
    expect(() => subscriptionOverrideService.resolveOverrideUntil({ days: 31 }, NOW)).toThrow(/30 days/);
    const ok = subscriptionOverrideService.resolveOverrideUntil({ days: 30 }, NOW);
    expect(ok.until.getTime()).toBe(NOW.getTime() + 30 * 86400000);
  });
  it("caps an explicit `until` at now + 30 days", () => {
    const tooFar = new Date(NOW.getTime() + 40 * 86400000).toISOString();
    expect(() => subscriptionOverrideService.resolveOverrideUntil({ until: tooFar }, NOW)).toThrow(/30 days/);
  });
  it("rejects a past `until`", () => {
    expect(() =>
      subscriptionOverrideService.resolveOverrideUntil({ until: new Date(NOW.getTime() - 1000).toISOString() }, NOW),
    ).toThrow();
  });
  it("rejects non-positive days", () => {
    expect(() => subscriptionOverrideService.resolveOverrideUntil({ days: 0 }, NOW)).toThrow();
  });
});

describe("subscriptionOverrideService.setOverride", () => {
  it("requires a reason", async () => {
    db.owner_subscriptions.findUnique.mockResolvedValue({ id: "sub-1", owner_id: "owner-A", status: "PAUSED" });
    await expect(
      subscriptionOverrideService.setOverride({ subscriptionId: "sub-1", adminId: "admin-9", reason: "  ", days: 3, now: NOW }),
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });
});
