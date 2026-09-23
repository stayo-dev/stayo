import { beforeEach, describe, expect, it, vi } from "vitest";

const { findEvents, findLeaves, findConsents, sendStayGuardianUpdate } = vi.hoisted(() => ({
  findEvents: vi.fn(),
  findLeaves: vi.fn(),
  findConsents: vi.fn(),
  sendStayGuardianUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    stay_events: { findMany: findEvents },
    stay_leaves: { findMany: findLeaves },
    stay_guardian_consent: { findMany: findConsents },
  },
}));

vi.mock("@/lib/services/notifications/command-center/stay-guardian-updates", () => ({
  sendStayGuardianUpdate,
}));

import { isStaleDeparture, runStayGuardianSweep } from "@/src/services/stay/stay-guardian-sweep";

describe("isStaleDeparture", () => {
  const today = "2026-09-28";

  it("is fresh while the leave is still active and the return date is ahead", () => {
    expect(isStaleDeparture({ leaveStatus: "ACTIVE", expectedReturnDate: "2026-09-30", today })).toBe(false);
  });

  it("is fresh on the return date itself", () => {
    expect(isStaleDeparture({ leaveStatus: "ACTIVE", expectedReturnDate: today, today })).toBe(false);
  });

  it("is stale once the return date has passed", () => {
    // "expected back on Sunday" must not arrive on Monday, to a parent who has
    // already seen their child.
    expect(isStaleDeparture({ leaveStatus: "ACTIVE", expectedReturnDate: "2026-09-27", today })).toBe(true);
  });

  it("is stale once the ward is already back", () => {
    expect(isStaleDeparture({ leaveStatus: "RETURNED", expectedReturnDate: "2026-09-30", today })).toBe(true);
  });

  it("is stale once the leave was cancelled", () => {
    expect(isStaleDeparture({ leaveStatus: "CANCELLED", expectedReturnDate: "2026-09-30", today })).toBe(true);
  });

  it("is stale when the leave cannot be found at all", () => {
    expect(isStaleDeparture({ leaveStatus: null, expectedReturnDate: "2026-09-30", today })).toBe(true);
  });
});

describe("runStayGuardianSweep", () => {
  const now = new Date("2026-09-28T04:30:00.000Z"); // 10:00 IST

  beforeEach(() => {
    vi.clearAllMocks();
    sendStayGuardianUpdate.mockResolvedValue({ sent: true, reason: "RETURN" });
    findLeaves.mockResolvedValue([]);
    findConsents.mockResolvedValue([{ tenant_id: "t1" }, { tenant_id: "t2" }]);
  });

  it("considers only the two notifiable event types", async () => {
    findEvents.mockResolvedValue([]);
    await runStayGuardianSweep(now);
    expect(findEvents.mock.calls[0][0].where.type.in.sort()).toEqual(["LEAVE_STARTED", "RETURNED"]);
  });

  it("asks only for live consents — granted, not revoked, not stopped", async () => {
    findEvents.mockResolvedValue([]);
    await runStayGuardianSweep(now);
    expect(findConsents.mock.calls[0][0].where).toEqual({
      granted: true,
      revoked_at: null,
      stopped_at: null,
    });
  });

  it("scopes the event query to those tenants", async () => {
    // Otherwise every run reloads every leave in the system to reach the same
    // NO_CONSENT it reached yesterday.
    findEvents.mockResolvedValue([]);
    await runStayGuardianSweep(now);
    expect(findEvents.mock.calls[0][0].where.tenant_id).toEqual({ in: ["t1", "t2"] });
  });

  it("does not query events at all when nobody has consented", async () => {
    findConsents.mockResolvedValue([]);
    const result = await runStayGuardianSweep(now);
    expect(findEvents).not.toHaveBeenCalled();
    expect(result).toEqual({ considered: 0, sent: 0, skipped: 0, stale: 0 });
  });

  it("re-attempts a return and counts the send", async () => {
    findEvents.mockResolvedValue([
      {
        id: "e1",
        tenant_id: "t1",
        type: "RETURNED",
        leave_type: null,
        expected_return_date: null,
        occurred_at: new Date("2026-09-27T18:00:00.000Z"),
      },
    ]);
    const result = await runStayGuardianSweep(now);
    expect(result).toEqual({ considered: 1, sent: 1, skipped: 0, stale: 0 });
    expect(sendStayGuardianUpdate.mock.calls[0][0].eventId).toBe("e1");
  });

  it("drops a departure whose return date has already passed", async () => {
    findEvents.mockResolvedValue([
      {
        id: "e2",
        tenant_id: "t2",
        type: "LEAVE_STARTED",
        leave_type: "GOING_HOME",
        expected_return_date: new Date("2026-09-27T00:00:00.000Z"),
        occurred_at: new Date("2026-09-26T10:00:00.000Z"),
      },
    ]);
    findLeaves.mockResolvedValue([{ id: "e2", status: "ACTIVE" }]);
    const result = await runStayGuardianSweep(now);
    expect(result).toEqual({ considered: 1, sent: 0, skipped: 0, stale: 1 });
    expect(sendStayGuardianUpdate).not.toHaveBeenCalled();
  });

  it("a return never goes stale — it is a completed fact", async () => {
    findEvents.mockResolvedValue([
      {
        id: "e3",
        tenant_id: "t1",
        type: "RETURNED",
        leave_type: null,
        expected_return_date: null,
        occurred_at: new Date("2026-09-26T18:00:00.000Z"),
      },
    ]);
    const result = await runStayGuardianSweep(now);
    expect(result.stale).toBe(0);
    expect(result.sent).toBe(1);
  });

  it("counts an already-sent event as skipped, not sent", async () => {
    findEvents.mockResolvedValue([
      {
        id: "e4",
        tenant_id: "t1",
        type: "RETURNED",
        leave_type: null,
        expected_return_date: null,
        occurred_at: new Date("2026-09-27T18:00:00.000Z"),
      },
    ]);
    sendStayGuardianUpdate.mockResolvedValue({ sent: false, reason: "ALREADY_SENT" });
    const result = await runStayGuardianSweep(now);
    expect(result).toEqual({ considered: 1, sent: 0, skipped: 1, stale: 0 });
  });

  it("one failing event does not abandon the rest of the run", async () => {
    findEvents.mockResolvedValue([
      { id: "e5", tenant_id: "t1", type: "RETURNED", leave_type: null, expected_return_date: null, occurred_at: now },
      { id: "e6", tenant_id: "t2", type: "RETURNED", leave_type: null, expected_return_date: null, occurred_at: now },
    ]);
    sendStayGuardianUpdate
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ sent: true, reason: "RETURN" });
    const result = await runStayGuardianSweep(now);
    expect(result.considered).toBe(2);
    expect(result.sent).toBe(1);
  });
});
