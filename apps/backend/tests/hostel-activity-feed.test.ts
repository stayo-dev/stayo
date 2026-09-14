import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    payments: { findMany: vi.fn(), aggregate: vi.fn() },
    expenses: { findMany: vi.fn(), aggregate: vi.fn() },
    roomAllocation: { findMany: vi.fn(), count: vi.fn() },
    move_out_requests: { findMany: vi.fn(), count: vi.fn() },
    tenant_invitations: { findMany: vi.fn() },
    identificationDocument: { findMany: vi.fn() },
    rooms: { findMany: vi.fn() },
    rent_obligations: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
  supabase: {},
}));

import { prisma } from "@/lib/db";
import { hostelActivityFeedService } from "@/lib/services/hostel-activity-feed-service";

const db = () => prisma as any;

const HOSTEL = "11111111-1111-1111-1111-111111111111";
const OTHER_HOSTEL = "22222222-2222-2222-2222-222222222222";
const OWNER = "99999999-9999-9999-9999-999999999999";

/** Every domain read empty, both raw log reads empty. Tests opt rows back in. */
function emptyEverything() {
  db().payments.findMany.mockResolvedValue([]);
  db().expenses.findMany.mockResolvedValue([]);
  db().roomAllocation.findMany.mockResolvedValue([]);
  db().move_out_requests.findMany.mockResolvedValue([]);
  db().tenant_invitations.findMany.mockResolvedValue([]);
  db().identificationDocument.findMany.mockResolvedValue([]);
  db().$queryRaw.mockResolvedValue([]);

  // Only reached when withPositions is true.
  db().payments.aggregate.mockResolvedValue({ _sum: { amount_paid: 0 } });
  db().expenses.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  db().rooms.findMany.mockResolvedValue([]);
  db().roomAllocation.count.mockResolvedValue(0);
}

const getEvents = (overrides: Record<string, any> = {}) =>
  hostelActivityFeedService.getEvents({
    hostelId: HOSTEL,
    ownerId: OWNER,
    withPositions: false,
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
  emptyEverything();
});

describe("hostel scoping", () => {
  it("scopes every domain read to the requested hostel", async () => {
    await getEvents();

    expect(db().payments.findMany.mock.calls[0][0].where.hostel_id).toBe(HOSTEL);
    expect(db().expenses.findMany.mock.calls[0][0].where.hostel_id).toBe(HOSTEL);
    expect(db().roomAllocation.findMany.mock.calls[0][0].where.hostel_id).toBe(HOSTEL);
    expect(db().move_out_requests.findMany.mock.calls[0][0].where.hostel_id).toBe(HOSTEL);
    expect(db().tenant_invitations.findMany.mock.calls[0][0].where.hostel_id).toBe(HOSTEL);
    // Documents hang off the tenant, not the hostel, so they scope via the relation.
    expect(db().identificationDocument.findMany.mock.calls[0][0].where.tenant.hostel_id).toBe(
      HOSTEL,
    );
  });

  // The regression this whole change exists for: both audit tables used to be
  // read with an owner-only filter, so a multi-hostel owner saw one property's
  // settings changes, rent runs and expense edits on every other property's
  // timeline.
  it("constrains the activity_logs read by hostel, not just by owner", async () => {
    await getEvents();

    const [strings, ...values] = db().$queryRaw.mock.calls[0];
    const sql = strings.join("?");

    expect(sql).toContain("FROM activity_logs");
    expect(sql).toContain("metadata->>'hostel_id'");
    expect(values).toContain(HOSTEL);
    expect(values).toContain(OWNER);
  });

  // AGREEMENT_RENEWED rows carry `tenant_id` and no hostel at all, so a JSON
  // filter would silently return nothing. The hostel has to come from the tenancy.
  it("resolves system_event_logs' hostel through the tenancy, not through metadata", async () => {
    await getEvents();

    const [strings, ...values] = db().$queryRaw.mock.calls[1];
    const sql = strings.join("?");

    expect(sql).toContain("FROM system_event_logs");
    expect(sql).toContain("JOIN tenants");
    expect(sql).toContain("t.hostel_id");
    expect(sql).not.toContain("metadata->>'hostel_id'");
    expect(values).toContain(HOSTEL);
  });

  it("never reads with the other hostel's id", async () => {
    await getEvents();

    const everyValue = db().$queryRaw.mock.calls.flatMap(([, ...v]: any[]) => v);
    expect(everyValue).not.toContain(OTHER_HOSTEL);
  });
});

describe("withPositions", () => {
  it("issues no reconstruction queries when positions are not asked for", async () => {
    await getEvents({ withPositions: false });

    expect(db().payments.aggregate).not.toHaveBeenCalled();
    expect(db().expenses.aggregate).not.toHaveBeenCalled();
    expect(db().roomAllocation.count).not.toHaveBeenCalled();
  });

  it("reconstructs balances when they are asked for", async () => {
    await getEvents({ withPositions: true });

    expect(db().payments.aggregate).toHaveBeenCalled();
    expect(db().expenses.aggregate).toHaveBeenCalled();
    expect(db().roomAllocation.count).toHaveBeenCalled();
  });

  // The old code fell back to `{ before: 0, after: 0 }` whenever the map
  // missed, which printed a confident, wrong "Cash Position ₹0 → ₹0".
  it("describes an expense instead of claiming a zero cash position", async () => {
    db().expenses.findMany.mockResolvedValue([
      {
        id: "e1",
        title: "Electricity",
        amount: 8400,
        category: "Utilities",
        vendor_name: "APSPDCL",
        created_at: new Date("2026-09-10T10:00:00Z"),
      },
    ]);

    const { items } = await getEvents({ withPositions: false });

    expect(items[0].subtitle).toBe("Utilities · APSPDCL");
    expect(items[0].subtitle).not.toContain("₹0");
    expect(items[0].metadata.cash_before).toBeUndefined();
  });
});

describe("room changes", () => {
  // Written by lib/events/index.ts since rooms gained event handlers, but the
  // route's entity_type filter never selected them — so they were invisible.
  it("renders ROOM logs, which nothing read back before", async () => {
    db().$queryRaw.mockResolvedValueOnce([
      {
        id: "log-1",
        action_type: "CREATE",
        entity_type: "ROOM",
        entity_id: "room-1",
        metadata: { room_no: "301", capacity: 4, hostel_id: HOSTEL },
        timestamp: new Date("2026-09-12T09:00:00Z"),
      },
      {
        id: "log-2",
        action_type: "DELETE",
        entity_type: "ROOM",
        entity_id: "room-2",
        metadata: { room_no: "112", hostel_id: HOSTEL },
        timestamp: new Date("2026-09-11T09:00:00Z"),
      },
    ]);

    const { items } = await getEvents();

    expect(items.map((e) => e.title)).toEqual(["Room 301 added", "Room 112 retired"]);
    expect(items[0].category).toBe("Occupancy");
    expect(items[0].subtitle).toBe("Capacity 4 beds");
  });

  it("asks for ROOM rows in the log query", async () => {
    await getEvents();
    const sql = db().$queryRaw.mock.calls[0][0].join("?");
    expect(sql).toContain("ROOM");
  });
});

describe("ordering, filtering and paging", () => {
  const payment = (id: string, at: string) => ({
    id,
    amount_paid: 1000,
    created_at: new Date(at),
    payment_method: "CASH",
    tenants: { profiles: { name: "Ravi" } },
    obligation: { total_amount: 5000 },
  });

  it("returns newest first across sources", async () => {
    db().payments.findMany.mockResolvedValue([
      payment("p-old", "2026-09-01T10:00:00Z"),
      payment("p-new", "2026-09-13T10:00:00Z"),
    ]);
    db().expenses.findMany.mockResolvedValue([
      {
        id: "e1",
        title: "Water",
        amount: 500,
        category: "Utilities",
        created_at: new Date("2026-09-07T10:00:00Z"),
      },
    ]);

    const { items } = await getEvents();

    expect(items.map((e) => e.id)).toEqual(["payment-p-new", "expense-e1", "payment-p-old"]);
  });

  it("filters by category and reports the filtered total", async () => {
    db().payments.findMany.mockResolvedValue([payment("p1", "2026-09-13T10:00:00Z")]);
    db().expenses.findMany.mockResolvedValue([
      {
        id: "e1",
        title: "Water",
        amount: 500,
        category: "Utilities",
        created_at: new Date("2026-09-07T10:00:00Z"),
      },
    ]);

    const { items, total } = await getEvents({ category: "Expenses" });

    expect(total).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe("Expenses");
  });

  it("pages without losing the unpaged total", async () => {
    db().payments.findMany.mockResolvedValue([
      payment("p1", "2026-09-13T10:00:00Z"),
      payment("p2", "2026-09-12T10:00:00Z"),
      payment("p3", "2026-09-11T10:00:00Z"),
    ]);

    const { items, total } = await getEvents({ limit: 2, offset: 1 });

    expect(total).toBe(3);
    expect(items.map((e) => e.id)).toEqual(["payment-p2", "payment-p3"]);
  });

  it("searches titles and metadata", async () => {
    db().payments.findMany.mockResolvedValue([payment("p1", "2026-09-13T10:00:00Z")]);
    db().expenses.findMany.mockResolvedValue([
      {
        id: "e1",
        title: "Water",
        amount: 500,
        category: "Utilities",
        created_at: new Date("2026-09-07T10:00:00Z"),
      },
    ]);

    expect((await getEvents({ search: "ravi" })).items.map((e) => e.id)).toEqual(["payment-p1"]);
    expect((await getEvents({ search: "water" })).items.map((e) => e.id)).toEqual(["expense-e1"]);
  });
});

describe("actors", () => {
  it("marks an offline-recorded payment as staff-entered and a gateway one as the tenant's", async () => {
    db().payments.findMany.mockResolvedValue([
      {
        id: "p1",
        amount_paid: 1000,
        created_at: new Date("2026-09-13T10:00:00Z"),
        payment_method: "CASH",
        offline_recorded_by: OWNER,
        tenants: { profiles: { name: "Ravi" } },
        obligation: { total_amount: 5000 },
      },
      {
        id: "p2",
        amount_paid: 2000,
        created_at: new Date("2026-09-12T10:00:00Z"),
        payment_method: "UPI",
        offline_recorded_by: null,
        tenants: { profiles: { name: "Priya" } },
        obligation: { total_amount: 2000 },
      },
    ]);

    const { items } = await getEvents();

    expect(items[0].actor.name).toBe("Staff");
    expect(items[1].actor.name).toBe("Tenant");
  });
});
