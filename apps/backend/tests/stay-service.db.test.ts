import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createTestHostel, createTestOwner } from "./factories/owner-factory";
import { createTestRoom } from "./factories/room-factory";
import { allocateTestRoom, createTestTenant } from "./factories/tenant-factory";
import { createStayService } from "@/src/services/stay/stay-service";
import { replayStayEvents } from "@/src/services/stay/stay-events";
import { eventFromRow, leaveFromRow } from "@/src/services/stay/stay-rows";
import { roomCapacityService } from "@/lib/services/room-capacity-service";

/**
 * What only Postgres can prove: the partial unique index under a real double
 * tap, idempotency-key dedupe, replay == projection, the append-only trigger,
 * and that Stay's residents are exactly roomCapacityService's occupied beds.
 *
 * Needs the migration `20260914100000_stay_status_events` applied to the test
 * database.
 */

const NOW = new Date("2026-09-14T06:30:00.000Z"); // Monday, noon IST
const svc = createStayService();
let hostelId: string;
let a: any, b: any, c: any, invited: any, former: any;

const key = () => `k-${Math.random().toString(36).slice(2, 12)}`;
const rec = (tenantId: string, type: string, extra: Record<string, unknown> = {}) =>
  svc.recordStayEvent({
    tenantId, hostelId, type, source: "APP", actorProfileId: null, actorRole: "TENANT",
    idempotencyKey: key(), now: NOW, ...extra,
  });
const home = (expectedReturnDate = "2026-09-16") => ({ leaveType: "GOING_HOME", expectedReturnDate });

beforeAll(async () => {
  const owner = await createTestOwner();
  const hostel = await createTestHostel(owner.id);
  hostelId = hostel.id;
  const room = await createTestRoom(hostel.id, { capacity: 6 });
  const resident = async (overrides: Record<string, unknown> = {}) => {
    const t = await createTestTenant(owner.id, hostel.id, overrides);
    await allocateTestRoom(t.id, (room as any).id, { hostel_id: hostel.id });
    return t;
  };
  a = await resident();
  b = await resident();
  c = await resident();
  invited = await resident({ status: "INVITED" });
  former = await resident({ status: "FORMER_TENANT" });
});

afterAll(async () => {
  await prisma.stay_leaves.deleteMany({ where: { hostel_id: hostelId } });
  await prisma.stay_events.deleteMany({ where: { hostel_id: hostelId } }); // DELETE is allowed; UPDATE is not
});

describe("stay service against Postgres", () => {
  it("a double tap from two devices yields one leave and one event", async () => {
    await Promise.all([rec(a.id, "LEAVE_STARTED", home()), rec(a.id, "LEAVE_STARTED", home())]);
    expect(await prisma.stay_leaves.count({ where: { tenant_id: a.id, status: "ACTIVE" } })).toBe(1);
    expect(await prisma.stay_events.count({ where: { tenant_id: a.id, type: "LEAVE_STARTED" } })).toBe(1);
  });

  it("a reused idempotency key is recorded once, whatever it is reused for", async () => {
    await rec(b.id, "LEAVE_STARTED", { ...home(), idempotencyKey: "reused-key-0001" });
    await rec(b.id, "RETURNED");
    await rec(b.id, "LEAVE_STARTED", { ...home(), idempotencyKey: "reused-key-0001" });
    expect(await prisma.stay_events.count({ where: { tenant_id: b.id, type: "LEAVE_STARTED" } })).toBe(1);
    expect(await prisma.stay_leaves.count({ where: { tenant_id: b.id, status: "ACTIVE" } })).toBe(0);
  });

  it("replaying the stream rebuilds exactly the projection", async () => {
    await rec(c.id, "LEAVE_STARTED", home());
    await rec(c.id, "RETURN_DATE_CHANGED", { expectedReturnDate: "2026-09-18" });
    await rec(c.id, "RETURNED");
    await rec(c.id, "LEAVE_STARTED", { leaveType: "VACATION", expectedReturnDate: "2026-09-30" });
    await rec(c.id, "LEAVE_CANCELLED");

    const events = (await prisma.stay_events.findMany({ where: { hostel_id: hostelId }, orderBy: { seq: "asc" } })).map(eventFromRow);
    const projection = (await prisma.stay_leaves.findMany({ where: { hostel_id: hostelId } })).map(leaveFromRow);
    const byId = (x: { id: string }, y: { id: string }) => x.id.localeCompare(y.id);
    expect(replayStayEvents(events).sort(byId)).toEqual(projection.sort(byId));
  });

  it("only ACTIVE residents may update their stay", async () => {
    await expect(rec(invited.id, "RETURNED")).rejects.toMatchObject({ code: "STAY_INELIGIBLE" });
    await expect(rec(former.id, "RETURNED")).rejects.toMatchObject({ code: "STAY_INELIGIBLE" });
  });

  it("here + away equals roomCapacityService's occupied beds", async () => {
    const board = await svc.getHostelBoard(hostelId, NOW);
    const capacity = await roomCapacityService.getHostelCapacityMap(hostelId);
    const occupied = Array.from(capacity.values()).reduce((total, r: any) => total + r.occupied, 0);
    expect(board.residents).toBe(3);
    expect(board.hereTonight + board.away).toBe(occupied);
  });

  it("the database refuses to edit an event", async () => {
    const one = await prisma.stay_events.findFirst({ where: { hostel_id: hostelId } });
    await expect(prisma.stay_events.update({ where: { id: one.id }, data: { source: "QR" } })).rejects.toThrow(/append-only/);
  });
});
