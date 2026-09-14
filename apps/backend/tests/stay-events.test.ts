import { describe, expect, it } from "vitest";
import { applyStayEvent, replayStayEvents, type LeaveState, type StayEvent } from "@/src/services/stay/stay-events";

let n = 0;
function ev(partial: Partial<StayEvent> & Pick<StayEvent, "type">): StayEvent {
  n += 1;
  return {
    id: `e${n}`,
    tenantId: "t1",
    hostelId: "h1",
    roomId: "r1",
    effectiveDate: "2026-09-14",
    occurredAt: `2026-09-14T06:${String(n).padStart(2, "0")}:00.000Z`,
    leaveType: null,
    expectedReturnDate: null,
    source: "APP",
    actorProfileId: "p1",
    actorRole: "TENANT",
    idempotencyKey: `k${n}`,
    ...partial,
  };
}
const start = (p: Partial<StayEvent> = {}) =>
  ev({ type: "LEAVE_STARTED", leaveType: "GOING_HOME", expectedReturnDate: "2026-09-16", ...p });

function activeFrom(event: StayEvent): LeaveState {
  const r = applyStayEvent(null, event);
  if (r.kind !== "record" || !r.after) throw new Error("expected a leave");
  return r.after;
}

describe("applyStayEvent", () => {
  it("starts a leave whose id is the event id", () => {
    const e = start();
    expect(applyStayEvent(null, e)).toEqual({
      kind: "record",
      before: null,
      after: {
        id: e.id, tenantId: "t1", hostelId: "h1", leaveType: "GOING_HOME",
        startDate: "2026-09-14", expectedReturnDate: "2026-09-16",
        status: "ACTIVE", returnedAt: null, lastEventId: e.id,
      },
    });
  });

  it("treats a second Going Home as a no-op, not an error", () => {
    expect(applyStayEvent(activeFrom(start()), start())).toEqual({ kind: "noop" });
  });

  it("rejects a leave without a valid type or date", () => {
    expect(applyStayEvent(null, start({ leaveType: null }))).toEqual({ kind: "reject", reason: "INVALID_LEAVE_TYPE" });
    expect(applyStayEvent(null, start({ expectedReturnDate: "2026-09-14" }))).toEqual({ kind: "reject", reason: "TOO_SOON" });
    expect(applyStayEvent(null, start({ expectedReturnDate: null }))).toEqual({ kind: "reject", reason: "INVALID_DATE" });
  });

  it("changes the return date of an active leave, and no-ops on the same date", () => {
    const active = activeFrom(start());
    const change = ev({ type: "RETURN_DATE_CHANGED", expectedReturnDate: "2026-09-20" });
    expect(applyStayEvent(active, change)).toMatchObject({
      kind: "record", after: { expectedReturnDate: "2026-09-20", lastEventId: change.id, status: "ACTIVE" },
    });
    expect(applyStayEvent(active, ev({ type: "RETURN_DATE_CHANGED", expectedReturnDate: "2026-09-16" }))).toEqual({ kind: "noop" });
    expect(applyStayEvent(null, change)).toEqual({ kind: "reject", reason: "NO_ACTIVE_LEAVE" });
  });

  it("closes a leave on RETURNED and no-ops when already back", () => {
    const active = activeFrom(start());
    const back = ev({ type: "RETURNED" });
    expect(applyStayEvent(active, back)).toMatchObject({
      kind: "record", after: { status: "RETURNED", returnedAt: back.occurredAt, lastEventId: back.id },
    });
    expect(applyStayEvent(null, ev({ type: "RETURNED" }))).toEqual({ kind: "noop" });
  });

  it("cancels only an active leave", () => {
    expect(applyStayEvent(activeFrom(start()), ev({ type: "LEAVE_CANCELLED" }))).toMatchObject({ kind: "record", after: { status: "CANCELLED" } });
    expect(applyStayEvent(null, ev({ type: "LEAVE_CANCELLED" }))).toEqual({ kind: "reject", reason: "NO_ACTIVE_LEAVE" });
  });

  it("records a presence confirmation without touching the projection", () => {
    expect(applyStayEvent(null, ev({ type: "PRESENCE_CONFIRMED" }))).toEqual({ kind: "record", before: null, after: null });
    expect(applyStayEvent(activeFrom(start()), ev({ type: "PRESENCE_CONFIRMED" }))).toEqual({ kind: "reject", reason: "ON_LEAVE" });
  });

  it("rejects an unknown type", () => {
    expect(applyStayEvent(null, ev({ type: "AWAY_TODAY" as any }))).toEqual({ kind: "reject", reason: "UNKNOWN_TYPE" });
  });
});

describe("replayStayEvents", () => {
  it("rebuilds each leave from the stream", () => {
    const s1 = start();
    const c1 = ev({ type: "RETURN_DATE_CHANGED", expectedReturnDate: "2026-09-18" });
    const b1 = ev({ type: "RETURNED" });
    const s2 = start({ expectedReturnDate: "2026-09-21" });
    const x2 = ev({ type: "LEAVE_CANCELLED" });
    const leaves = replayStayEvents([s1, c1, b1, s2, x2]);
    expect(leaves).toHaveLength(2);
    expect(leaves[0]).toMatchObject({ id: s1.id, status: "RETURNED", expectedReturnDate: "2026-09-18", lastEventId: b1.id });
    expect(leaves[1]).toMatchObject({ id: s2.id, status: "CANCELLED", lastEventId: x2.id });
  });

  it("skips events the reducer would not have recorded", () => {
    const s1 = start();
    const dup = start(); // noop
    const bad = ev({ type: "LEAVE_CANCELLED", tenantId: "t2" }); // reject
    expect(replayStayEvents([s1, dup, bad])).toEqual([activeFrom(s1)]);
  });

  it("keeps tenants independent", () => {
    const a = start({ tenantId: "tA" });
    const b = start({ tenantId: "tB" });
    const backA = ev({ type: "RETURNED", tenantId: "tA" });
    const leaves = replayStayEvents([a, b, backA]);
    expect(leaves.find((l) => l.tenantId === "tA")?.status).toBe("RETURNED");
    expect(leaves.find((l) => l.tenantId === "tB")?.status).toBe("ACTIVE");
  });
});
