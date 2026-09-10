import { describe, expect, it } from "vitest";
import {
  MIN_CYCLES_FOR_SCORE,
  computeTenantScore,
  projectEarlyExit,
  type PaymentCycle,
  type Tenancy,
} from "@/src/services/tenants/tenant-score-model";

/**
 * The tenant score.
 *
 * Replaces an algorithm that started everyone at 100, looked back only three
 * months, and charged a late payment twice — once at −10 for being late and
 * again at −5 per reminder, though a reminder is sent *because* it is late.
 * Three reminders on one debt cost 25 of 100.
 *
 * Two components now: how reliably they pay, and how committed they are to
 * seeing a stay through. Reminders are not an input at all.
 */

const NOW = new Date("2026-08-27T00:00:00.000Z");

/** A cycle `monthsAgo` before NOW, settled `daysLate` after its due date. */
function cycle(monthsAgo: number, daysLate: number): PaymentCycle {
  const due = new Date(Date.UTC(2026, 7 - monthsAgo, 5));
  const paid = new Date(due.getTime() + daysLate * 24 * 60 * 60 * 1000);
  return { dueDate: due.toISOString(), settledAt: paid.toISOString() };
}

function onTimeCycles(count: number): PaymentCycle[] {
  return Array.from({ length: count }, (_, i) => cycle(count - i, 0));
}

function tenancy(overrides: Partial<Tenancy> = {}): Tenancy {
  return {
    startedAt: "2025-08-01T00:00:00.000Z",
    endedAt: null,
    expectedMonths: 11,
    ...overrides,
  };
}

describe("cold start", () => {
  it("refuses to score a tenant with too little history", () => {
    const result = computeTenantScore({ cycles: onTimeCycles(MIN_CYCLES_FOR_SCORE - 1), tenancies: [tenancy()], now: NOW });
    expect(result.status).toBe("INSUFFICIENT_HISTORY");
    expect(result.score).toBeNull();
    expect(result.grade).toBeNull();
  });

  it("scores once there is enough to judge", () => {
    const result = computeTenantScore({
      cycles: onTimeCycles(MIN_CYCLES_FOR_SCORE),
      tenancies: [tenancy()],
      now: NOW,
    });
    expect(result.status).toBe("SCORED");
    expect(result.score).not.toBeNull();
  });

  it("says how many more cycles are needed", () => {
    const result = computeTenantScore({ cycles: onTimeCycles(1), tenancies: [tenancy()], now: NOW });
    expect(result.cyclesNeeded).toBe(MIN_CYCLES_FOR_SCORE - 1);
  });

  it("never reports a brand-new tenant as excellent", () => {
    // The old model's worst behaviour: no history read as 100/EXCELLENT,
    // which is precisely the tenant an owner most needs warning about.
    const result = computeTenantScore({ cycles: [], tenancies: [tenancy()], now: NOW });
    expect(result.score).toBeNull();
    expect(result.grade).toBeNull();
  });
});

describe("payment reliability", () => {
  it("rewards a consistently on-time payer", () => {
    const result = computeTenantScore({ cycles: onTimeCycles(12), tenancies: [tenancy()], now: NOW });
    expect(result.components.paymentReliability).toBeGreaterThan(60);
  });

  it("punishes a consistently very late payer", () => {
    const cycles = Array.from({ length: 12 }, (_, i) => cycle(12 - i, 45));
    const result = computeTenantScore({ cycles, tenancies: [tenancy()], now: NOW });
    expect(result.components.paymentReliability).toBe(0);
  });

  it("treats a two-day slip far more gently than a six-week one", () => {
    const slight = computeTenantScore({
      cycles: Array.from({ length: 6 }, (_, i) => cycle(6 - i, 2)),
      tenancies: [tenancy()],
      now: NOW,
    });
    const severe = computeTenantScore({
      cycles: Array.from({ length: 6 }, (_, i) => cycle(6 - i, 45)),
      tenancies: [tenancy()],
      now: NOW,
    });
    expect(slight.components.paymentReliability!).toBeGreaterThan(
      severe.components.paymentReliability! + 40,
    );
  });

  it("weighs recent behaviour above old behaviour", () => {
    // Same number of late cycles; only when they happened differs.
    const recentlyBad = [...onTimeCycles(6).slice(0, 3), cycle(3, 20), cycle(2, 20), cycle(1, 20)];
    const formerlyBad = [cycle(12, 20), cycle(11, 20), cycle(10, 20), ...onTimeCycles(3)];

    const recent = computeTenantScore({ cycles: recentlyBad, tenancies: [tenancy()], now: NOW });
    const former = computeTenantScore({ cycles: formerlyBad, tenancies: [tenancy()], now: NOW });

    expect(former.components.paymentReliability!).toBeGreaterThan(
      recent.components.paymentReliability!,
    );
  });

  it("counts an unpaid overdue cycle as late by how long it has been outstanding", () => {
    const unsettled: PaymentCycle = {
      dueDate: new Date(Date.UTC(2026, 6, 5)).toISOString(),
      settledAt: null,
    };
    const result = computeTenantScore({
      cycles: [...onTimeCycles(3), unsettled],
      tenancies: [tenancy()],
      now: NOW,
    });
    const clean = computeTenantScore({ cycles: onTimeCycles(4), tenancies: [tenancy()], now: NOW });
    expect(result.components.paymentReliability!).toBeLessThan(clean.components.paymentReliability!);
  });

  it("does not count a cycle that is not yet due", () => {
    const future: PaymentCycle = {
      dueDate: new Date(Date.UTC(2026, 9, 5)).toISOString(),
      settledAt: null,
    };
    const withFuture = computeTenantScore({
      cycles: [...onTimeCycles(3), future],
      tenancies: [tenancy()],
      now: NOW,
    });
    const without = computeTenantScore({ cycles: onTimeCycles(3), tenancies: [tenancy()], now: NOW });
    expect(withFuture.components.paymentReliability).toBe(without.components.paymentReliability);
    expect(withFuture.resolvedCycles).toBe(3);
  });
});

describe("commitment", () => {
  it("rewards accumulated tenure", () => {
    const long = computeTenantScore({
      cycles: onTimeCycles(12),
      tenancies: [tenancy({ startedAt: "2025-01-01T00:00:00.000Z" })],
      now: NOW,
    });
    const short = computeTenantScore({
      cycles: onTimeCycles(12),
      tenancies: [tenancy({ startedAt: "2026-06-01T00:00:00.000Z" })],
      now: NOW,
    });
    expect(long.components.commitment!).toBeGreaterThan(short.components.commitment!);
  });

  it("does not penalise a stay that is still running", () => {
    // Being three months into an eleven-month agreement is not leaving early.
    const result = computeTenantScore({
      cycles: onTimeCycles(3),
      tenancies: [tenancy({ startedAt: "2026-05-01T00:00:00.000Z", endedAt: null })],
      now: NOW,
    });
    expect(result.earlyExits).toBe(0);
  });

  it("penalises a stay ended well before its expected duration", () => {
    const kept = computeTenantScore({
      cycles: onTimeCycles(12),
      tenancies: [tenancy({ startedAt: "2025-08-01", endedAt: "2026-07-01", expectedMonths: 11 })],
      now: NOW,
    });
    const walked = computeTenantScore({
      cycles: onTimeCycles(12),
      tenancies: [tenancy({ startedAt: "2026-06-01", endedAt: "2026-08-01", expectedMonths: 11 })],
      now: NOW,
    });
    expect(walked.components.commitment!).toBeLessThan(kept.components.commitment!);
    expect(walked.earlyExits).toBe(1);
  });

  it("does not penalise a stay that ran its full expected length", () => {
    const result = computeTenantScore({
      cycles: onTimeCycles(12),
      tenancies: [tenancy({ startedAt: "2025-08-01", endedAt: "2026-07-05", expectedMonths: 11 })],
      now: NOW,
    });
    expect(result.earlyExits).toBe(0);
  });

  it("penalises leaving at month 1 far more than leaving at month 10", () => {
    const almostDone = computeTenantScore({
      cycles: onTimeCycles(12),
      tenancies: [tenancy({ startedAt: "2025-10-01", endedAt: "2026-08-01", expectedMonths: 11 })],
      now: NOW,
    });
    const walkedOut = computeTenantScore({
      cycles: onTimeCycles(12),
      tenancies: [tenancy({ startedAt: "2026-07-01", endedAt: "2026-08-01", expectedMonths: 11 })],
      now: NOW,
    });
    expect(walkedOut.components.commitment!).toBeLessThan(almostDone.components.commitment!);
  });

  it("lets an old early exit fade to nothing", () => {
    // 18 months on, later behaviour is the story — not one departure.
    const result = computeTenantScore({
      cycles: onTimeCycles(12),
      tenancies: [
        tenancy({ startedAt: "2023-01-01", endedAt: "2023-02-01", expectedMonths: 11 }),
        tenancy({ startedAt: "2025-08-01", endedAt: null }),
      ],
      now: NOW,
    });
    expect(result.earlyExits).toBe(0);
  });

  it("still counts a recent early exit", () => {
    const result = computeTenantScore({
      cycles: onTimeCycles(12),
      tenancies: [
        tenancy({ startedAt: "2026-05-01", endedAt: "2026-06-01", expectedMonths: 11 }),
        tenancy({ startedAt: "2026-06-15", endedAt: null }),
      ],
      now: NOW,
    });
    expect(result.earlyExits).toBe(1);
  });

  it("falls back to the hostel's expected tenure when no agreement set one", () => {
    // A hostel with agreements switched off (ADR-059) still has a notion of
    // how long a stay should be, or leaving early could never be measured.
    const result = computeTenantScore({
      cycles: onTimeCycles(6),
      tenancies: [tenancy({ startedAt: "2026-07-01", endedAt: "2026-08-01", expectedMonths: 6 })],
      now: NOW,
    });
    expect(result.earlyExits).toBe(1);
  });
});

describe("the score itself", () => {
  it("stays within 0 and 100", () => {
    const awful = computeTenantScore({
      cycles: Array.from({ length: 12 }, (_, i) => cycle(12 - i, 90)),
      tenancies: [
        tenancy({ startedAt: "2026-06-01", endedAt: "2026-07-01", expectedMonths: 11 }),
        tenancy({ startedAt: "2026-07-01", endedAt: "2026-08-01", expectedMonths: 11 }),
      ],
      now: NOW,
    });
    expect(awful.score).toBeGreaterThanOrEqual(0);
    expect(awful.score).toBeLessThanOrEqual(100);
  });

  it("grades a strong record well and a poor one badly", () => {
    const strong = computeTenantScore({
      cycles: onTimeCycles(12),
      tenancies: [tenancy({ startedAt: "2025-01-01" })],
      now: NOW,
    });
    const weak = computeTenantScore({
      cycles: Array.from({ length: 12 }, (_, i) => cycle(12 - i, 40)),
      tenancies: [tenancy({ startedAt: "2026-06-01" })],
      now: NOW,
    });
    expect(strong.grade).toBe("EXCELLENT");
    expect(["NEEDS_ATTENTION", "HIGH_RISK"]).toContain(weak.grade);
  });

  it("explains itself in the owner's terms", () => {
    const result = computeTenantScore({
      cycles: [...onTimeCycles(5), cycle(1, 12)],
      tenancies: [tenancy()],
      now: NOW,
    });
    expect(result.insights.join(' ')).toMatch(/on time|late/i);
  });
});

describe("projectEarlyExit", () => {
  it("shows what leaving now would cost", () => {
    const base = {
      cycles: onTimeCycles(6),
      tenancies: [tenancy({ startedAt: "2026-05-01", endedAt: null, expectedMonths: 11 })],
      now: NOW,
    };
    const projection = projectEarlyExit(base, { tenancyIndex: 0 });

    expect(projection.current).not.toBeNull();
    expect(projection.projected).toBeLessThan(projection.current!);
    expect(projection.drop).toBeGreaterThan(0);
  });

  it("reports no penalty when the stay has already run its course", () => {
    const base = {
      cycles: onTimeCycles(12),
      tenancies: [tenancy({ startedAt: "2025-08-01", endedAt: null, expectedMonths: 11 })],
      now: NOW,
    };
    const projection = projectEarlyExit(base, { tenancyIndex: 0 });
    expect(projection.drop).toBe(0);
    expect(projection.wouldBeEarly).toBe(false);
  });

  it("says how long the mark takes to fade, so the tenant knows it is not forever", () => {
    const base = {
      cycles: onTimeCycles(6),
      tenancies: [tenancy({ startedAt: "2026-06-01", endedAt: null, expectedMonths: 11 })],
      now: NOW,
    };
    expect(projectEarlyExit(base, { tenancyIndex: 0 }).recoversInMonths).toBe(18);
  });

  it("cannot project for a tenant who has no score yet", () => {
    const base = { cycles: onTimeCycles(1), tenancies: [tenancy()], now: NOW };
    const projection = projectEarlyExit(base, { tenancyIndex: 0 });
    expect(projection.current).toBeNull();
    expect(projection.drop).toBe(0);
  });
});

describe("trend", () => {
  it("reads as improving when recent cycles beat older ones", () => {
    const cycles = [cycle(10, 25), cycle(9, 25), cycle(8, 25), cycle(3, 0), cycle(2, 0), cycle(1, 0)];
    expect(computeTenantScore({ cycles, tenancies: [tenancy()], now: NOW }).trend).toBe("IMPROVING");
  });

  it("reads as declining when recent cycles are worse", () => {
    const cycles = [cycle(10, 0), cycle(9, 0), cycle(8, 0), cycle(3, 25), cycle(2, 25), cycle(1, 25)];
    expect(computeTenantScore({ cycles, tenancies: [tenancy()], now: NOW }).trend).toBe("DECLINING");
  });

  it("reads as stable when behaviour has not moved", () => {
    expect(computeTenantScore({ cycles: onTimeCycles(8), tenancies: [tenancy()], now: NOW }).trend).toBe("STABLE");
  });

  it("does not guess a trend from too few cycles", () => {
    // Three cycles is enough to score but not enough to claim a direction.
    expect(computeTenantScore({ cycles: onTimeCycles(3), tenancies: [tenancy()], now: NOW }).trend).toBe("STABLE");
  });
});
