import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const prisma: any = {
    owner_subscriptions: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  return { prisma };
});
const { eventLogMock } = vi.hoisted(() => ({ eventLogMock: { log: vi.fn(async () => undefined) } }));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: eventLogMock }));

import { prisma } from "@/lib/db";
import { subscriptionLifecycleService, shouldPause } from "@/src/services/platform-billing/subscription-lifecycle-service";
import { computeRenewal, renewalUpdateData } from "@/src/services/platform-billing/subscription-renewal-service";

const db = prisma as any;

// ── shouldPause (pure) ─────────────────────────────────────────────────────
describe("shouldPause — expiry with NO grace period", () => {
  const periodEnd = new Date("2026-10-01T00:00:00Z");

  it("ACTIVE and now is exactly the period end → pause", () => {
    expect(shouldPause({ status: "ACTIVE", current_period_end: periodEnd, admin_override_until: null }, periodEnd)).toBe(true);
  });
  it("ACTIVE and now is one second before period end → do NOT pause", () => {
    const justBefore = new Date(periodEnd.getTime() - 1000);
    expect(shouldPause({ status: "ACTIVE", current_period_end: periodEnd, admin_override_until: null }, justBefore)).toBe(false);
  });
  it("ACTIVE, period long over, no override → pause", () => {
    const later = new Date("2026-10-20T00:00:00Z");
    expect(shouldPause({ status: "ACTIVE", current_period_end: periodEnd, admin_override_until: null }, later)).toBe(true);
  });
  it("already PAUSED → shouldPause is false (nothing to do)", () => {
    const later = new Date("2026-10-20T00:00:00Z");
    expect(shouldPause({ status: "PAUSED", current_period_end: periodEnd, admin_override_until: null }, later)).toBe(false);
  });
  it("a valid admin override prevents the pause", () => {
    const later = new Date("2026-10-10T00:00:00Z");
    const overrideUntil = new Date("2026-10-15T00:00:00Z");
    expect(shouldPause({ status: "ACTIVE", current_period_end: periodEnd, admin_override_until: overrideUntil }, later)).toBe(false);
  });
  it("an EXPIRED admin override does not prevent the pause", () => {
    const later = new Date("2026-10-20T00:00:00Z");
    const overrideUntil = new Date("2026-10-15T00:00:00Z"); // already passed by `later`
    expect(shouldPause({ status: "ACTIVE", current_period_end: periodEnd, admin_override_until: overrideUntil }, later)).toBe(true);
  });
  it("no current_period_end → not paused", () => {
    expect(shouldPause({ status: "ACTIVE", current_period_end: null, admin_override_until: null }, new Date())).toBe(false);
  });
});

// ── runExpirySweep ─────────────────────────────────────────────────────────
describe("runExpirySweep", () => {
  const NOW = new Date("2026-10-05T06:00:00Z");
  beforeEach(() => {
    vi.clearAllMocks();
    db.owner_subscriptions.updateMany.mockResolvedValue({ count: 1 });
  });

  it("pauses an expired subscription and emits a SYSTEM-actor event", async () => {
    db.owner_subscriptions.findMany.mockResolvedValue([
      { id: "sub-1", owner_id: "owner-A", status: "ACTIVE", current_period_end: new Date("2026-10-01"), admin_override_until: null },
    ]);
    const result = await subscriptionLifecycleService.runExpirySweep(NOW);
    expect(result.paused).toBe(1);
    expect(db.owner_subscriptions.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sub-1", status: "ACTIVE" }, data: expect.objectContaining({ status: "PAUSED" }) }),
    );
    expect(eventLogMock.log).toHaveBeenCalledWith(
      "SUBSCRIPTION_PAUSED",
      "owner-A",
      expect.objectContaining({ actor: "SYSTEM", reason: "PERIOD_ENDED_NO_RENEWAL" }),
    );
  });

  it("does not pause a subscription held by a valid override", async () => {
    db.owner_subscriptions.findMany.mockResolvedValue([
      { id: "sub-1", owner_id: "owner-A", status: "ACTIVE", current_period_end: new Date("2026-10-01"), admin_override_until: new Date("2026-10-20") },
    ]);
    const result = await subscriptionLifecycleService.runExpirySweep(NOW);
    expect(result.paused).toBe(0);
    expect(result.held_by_override).toBe(1);
    expect(db.owner_subscriptions.updateMany).not.toHaveBeenCalled();
  });

  it("is idempotent — a second run pauses nothing (status guard makes updateMany a no-op)", async () => {
    db.owner_subscriptions.findMany.mockResolvedValue([
      { id: "sub-1", owner_id: "owner-A", status: "ACTIVE", current_period_end: new Date("2026-10-01"), admin_override_until: null },
    ]);
    db.owner_subscriptions.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const first = await subscriptionLifecycleService.runExpirySweep(NOW);
    const second = await subscriptionLifecycleService.runExpirySweep(NOW);
    expect(first.paused).toBe(1);
    expect(second.paused).toBe(0);
  });

  it("scans nothing when there are no expired subscriptions", async () => {
    db.owner_subscriptions.findMany.mockResolvedValue([]);
    const result = await subscriptionLifecycleService.runExpirySweep(NOW);
    expect(result).toMatchObject({ scanned: 0, paused: 0 });
  });
});

// ── computeRenewal (pure) ──────────────────────────────────────────────────
describe("computeRenewal — no overlapping / duplicate periods", () => {
  const NOW = new Date("2026-10-05T09:00:00Z");

  it("ACTIVE + still-live period → next period starts at the OLD period end (no date shift for a late payment)", () => {
    const out = computeRenewal({
      now: NOW,
      currentStatus: "ACTIVE",
      currentPeriodEnd: new Date("2026-10-10"),
      pendingPlanId: null,
      pendingPlanPricePaise: null,
      paymentPlanId: "plan-growth",
      paymentPlanPricePaise: 249900,
    });
    expect(out.status).toBe("ACTIVE");
    expect(out.period.start.toISOString().slice(0, 10)).toBe("2026-10-10");
    expect(out.period.end.toISOString().slice(0, 10)).toBe("2026-11-10");
    expect(out.effective_plan_id).toBe("plan-growth");
    expect(out.cleared_pending).toBe(false);
  });

  it("ACTIVE but period already over → next period starts TODAY (still no overlap)", () => {
    const out = computeRenewal({
      now: NOW,
      currentStatus: "ACTIVE",
      currentPeriodEnd: new Date("2026-09-30"),
      pendingPlanId: null,
      pendingPlanPricePaise: null,
      paymentPlanId: "plan-growth",
      paymentPlanPricePaise: 249900,
    });
    expect(out.period.start.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(out.period.end.toISOString().slice(0, 10)).toBe("2026-11-05");
  });

  it("PAUSED + approved payment → reactivates from today, status ACTIVE", () => {
    const out = computeRenewal({
      now: NOW,
      currentStatus: "PAUSED",
      currentPeriodEnd: new Date("2026-09-01"),
      pendingPlanId: null,
      pendingPlanPricePaise: null,
      paymentPlanId: "plan-starter",
      paymentPlanPricePaise: 149900,
    });
    expect(out.status).toBe("ACTIVE");
    expect(out.period.start.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(out.period.end.toISOString().slice(0, 10)).toBe("2026-11-05");
  });

  it("a queued downgrade applies at renewal: new plan = pending, its full price, pending cleared", () => {
    const out = computeRenewal({
      now: NOW,
      currentStatus: "ACTIVE",
      currentPeriodEnd: new Date("2026-10-10"),
      pendingPlanId: "plan-starter",
      pendingPlanPricePaise: 149900,
      paymentPlanId: "plan-growth", // owner mistakenly paid the old price — renewal still applies STARTER
      paymentPlanPricePaise: 249900,
    });
    expect(out.effective_plan_id).toBe("plan-starter");
    expect(out.full_price_paise).toBe(149900);
    expect(out.cleared_pending).toBe(true);
  });

  it("renewalUpdateData clears pending_plan_id and any admin override", () => {
    const out = computeRenewal({
      now: NOW,
      currentStatus: "ACTIVE",
      currentPeriodEnd: new Date("2026-10-10"),
      pendingPlanId: "plan-starter",
      pendingPlanPricePaise: 149900,
      paymentPlanId: "plan-starter",
      paymentPlanPricePaise: 149900,
    });
    const data = renewalUpdateData(out, { now: NOW, startedAt: new Date("2026-01-01") });
    expect(data.pending_plan_id).toBeNull();
    expect(data.admin_override_until).toBeNull();
    expect(data.status).toBe("ACTIVE");
    expect(data.started_at).toEqual(new Date("2026-01-01")); // preserved
  });
});
