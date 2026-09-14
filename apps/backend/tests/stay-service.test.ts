import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { createStayService } from "@/src/services/stay/stay-service";
import { eventFromRow, eventToRow, leaveFromRow, leaveToRow } from "@/src/services/stay/stay-rows";
import type { StayEvent } from "@/src/services/stay/stay-events";

const NOW = new Date("2026-09-14T06:30:00.000Z"); // Monday, noon IST
const KEY = "tap-0001-abcd";
const BASE = { tenantId: "t1", hostelId: "h1", source: "QR", actorProfileId: "p1", actorRole: "TENANT" as const, idempotencyKey: KEY, now: NOW };

function leaveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "leave-1", tenant_id: "t1", hostel_id: "h1", leave_type: "GOING_HOME",
    start_date: new Date("2026-09-13T00:00:00.000Z"), expected_return_date: new Date("2026-09-16T00:00:00.000Z"),
    status: "ACTIVE", returned_at: null, last_event_id: "leave-1", ...overrides,
  };
}

function makeDb({ resident = true, active = null as any } = {}) {
  let current = active;
  const db: any = {
    roomAllocation: {
      findFirst: vi.fn(async () => (resident ? { room_id: "r1" } : null)),
      findMany: vi.fn(async () => []),
    },
    stay_leaves: {
      findFirst: vi.fn(async () => current),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: any) => (current = data)),
      updateMany: vi.fn(async ({ data }: any) => {
        current = data.status === "ACTIVE" ? { ...current, ...data } : null;
        return { count: 1 };
      }),
    },
    stay_events: { create: vi.fn(async ({ data }: any) => data), findMany: vi.fn(async () => []) },
    tenants: { findFirst: vi.fn(async () => null) },
    hostels: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return db;
}
const capacity = { getHostelCapacityMap: vi.fn(async () => new Map()) } as any;
const service = (db: any, cap = capacity) => createStayService({ db, capacity: cap });

describe("recordStayEvent", () => {
  it("refuses anyone who is not a current resident", async () => {
    const db = makeDb({ resident: false });
    await expect(service(db).recordStayEvent({ ...BASE, type: "RETURNED" })).rejects.toMatchObject({ code: "STAY_INELIGIBLE", status: 409 });
    expect(db.stay_events.create).not.toHaveBeenCalled();
  });

  it("records Going Home as one event plus one leave, in one transaction", async () => {
    const db = makeDb();
    const stay = await service(db).recordStayEvent({ ...BASE, type: "LEAVE_STARTED", leaveType: "GOING_HOME", expectedReturnDate: "2026-09-15" });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const event = db.stay_events.create.mock.calls[0][0].data;
    expect(event).toMatchObject({ type: "LEAVE_STARTED", tenant_id: "t1", hostel_id: "h1", room_id: "r1", source: "QR", actor_role: "TENANT", idempotency_key: `t1:${KEY}` });
    expect(event.effective_date.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(db.stay_leaves.create.mock.calls[0][0].data).toMatchObject({ id: event.id, status: "ACTIVE", last_event_id: event.id });
    expect(stay).toMatchObject({
      status: "ON_LEAVE", leave: { leaveType: "GOING_HOME", expectedReturnDate: "2026-09-15" },
      today: "2026-09-14", minReturnDate: "2026-09-15", maxReturnDate: "2026-12-13",
      suggestedReturn: { date: "2026-09-15", label: "tomorrow" },
    });
  });

  it("keys a presence confirmation per tenant per IST day and writes no leave", async () => {
    const db = makeDb();
    await service(db).recordStayEvent({ ...BASE, type: "PRESENCE_CONFIRMED", idempotencyKey: undefined });
    expect(db.stay_events.create.mock.calls[0][0].data.idempotency_key).toBe("presence:t1:2026-09-14");
    expect(db.stay_leaves.create).not.toHaveBeenCalled();
  });

  it("treats a replayed tap (key already used) as success", async () => {
    const db = makeDb();
    db.stay_events.create.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    await expect(
      service(db).recordStayEvent({ ...BASE, type: "LEAVE_STARTED", leaveType: "GOING_HOME", expectedReturnDate: "2026-09-15" }),
    ).resolves.toMatchObject({ status: "PRESENT" });
  });

  it("rolls back quietly when a concurrent write moved the leave first", async () => {
    const db = makeDb({ active: leaveRow() });
    db.stay_leaves.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service(db).recordStayEvent({ ...BASE, type: "RETURNED" })).resolves.toBeDefined();
    expect(db.stay_leaves.updateMany.mock.calls[0][0].where).toEqual({ id: "leave-1", last_event_id: "leave-1" });
  });

  it("writes nothing for I'm Back when already back", async () => {
    const db = makeDb();
    await expect(service(db).recordStayEvent({ ...BASE, type: "RETURNED" })).resolves.toMatchObject({ status: "PRESENT" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("turns a reducer rejection into a readable 400", async () => {
    const db = makeDb({ active: leaveRow() });
    await expect(
      service(db).recordStayEvent({ ...BASE, type: "RETURN_DATE_CHANGED", expectedReturnDate: "2026-09-14" }),
    ).rejects.toMatchObject({ code: "TOO_SOON", status: 400 });
  });

  it("validates type, source and the client key before touching the database", async () => {
    const db = makeDb();
    await expect(service(db).recordStayEvent({ ...BASE, type: "AWAY_TODAY" })).rejects.toMatchObject({ code: "UNKNOWN_TYPE" });
    await expect(service(db).recordStayEvent({ ...BASE, type: "RETURNED", source: "SMS" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(service(db).recordStayEvent({ ...BASE, type: "RETURNED", idempotencyKey: "x" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(db.roomAllocation.findFirst).not.toHaveBeenCalled();
  });
});

describe("getMyStay", () => {
  it("says someone with no live tenancy is not a resident", async () => {
    expect(await service(makeDb()).getMyStay("p1", NOW)).toEqual({ tenantId: null, hostel: null, resident: false, stay: null });
  });

  it("gives a resident their stay and hostel", async () => {
    const db = makeDb();
    db.tenants.findFirst.mockResolvedValueOnce({ id: "t1", hostel_id: "h1", hostels: { id: "h1", name: "Sri Adithya" } });
    expect(await service(db).getMyStay("p1", NOW)).toMatchObject({ tenantId: "t1", hostel: { id: "h1", name: "Sri Adithya" }, resident: true, stay: { status: "PRESENT" } });
  });
});

describe("getHostelBoard", () => {
  it("composes residents, active leaves and roomCapacityService", async () => {
    const db = makeDb();
    db.roomAllocation.findMany.mockResolvedValueOnce([
      { tenant_id: "t1", room_id: "r1", room: { room_no: "101" }, tenant: { display_name: null, profiles: { name: "Asha" } } },
      { tenant_id: "t2", room_id: "r1", room: { room_no: "101" }, tenant: { display_name: "Ravi", profiles: { name: "R" } } },
    ]);
    db.stay_leaves.findMany.mockResolvedValueOnce([leaveRow({ tenant_id: "t2", expected_return_date: new Date("2026-09-14T00:00:00.000Z") })]);
    const cap = { getHostelCapacityMap: vi.fn(async () => new Map([["r1", { room_id: "r1", capacity: 3, occupied: 2, available: 1 }]])) } as any;
    const board = await service(db, cap).getHostelBoard("h1", NOW);
    expect(cap.getHostelCapacityMap).toHaveBeenCalledWith("h1");
    expect(board).toMatchObject({
      hereTonight: 2, beds: { capacity: 3, occupied: 2, free: 1 },
      backToday: [{ name: "Ravi", roomNo: "101", arrived: false }],
      suggestedReturn: { date: "2026-09-15", label: "tomorrow" },
    });
    expect(db.stay_events.findMany.mock.calls[0][0].where).toMatchObject({ hostel_id: "h1", type: "RETURNED" });
  });
});

describe("row mappers", () => {
  it("round-trip events and leaves losslessly", () => {
    const event: StayEvent = {
      id: "e1", tenantId: "t1", hostelId: "h1", roomId: "r1", type: "LEAVE_STARTED", effectiveDate: "2026-09-14",
      occurredAt: "2026-09-14T06:30:00.000Z", leaveType: "VACATION", expectedReturnDate: "2026-09-30",
      source: "APP", actorProfileId: "p1", actorRole: "TENANT", idempotencyKey: "t1:k",
    };
    expect(eventFromRow(eventToRow(event))).toEqual(event);
    const leave = leaveFromRow(leaveRow());
    expect(leaveFromRow(leaveToRow(leave))).toEqual(leave);
  });
});
