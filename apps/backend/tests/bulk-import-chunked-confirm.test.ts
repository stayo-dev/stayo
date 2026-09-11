import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Confirm runs in chunks.
 *
 * Each row is a transaction plus a notification dispatch, so a whole batch in
 * one request could not finish inside the function's time limit. The client
 * re-POSTs while `progress.remaining > 0`. Rows already SUCCESS are excluded
 * from the next chunk, which is what makes a dropped connection harmless —
 * and what must never let a tenant be invited twice.
 */

const { mockPrisma, mockLifecycle, mockRooms } = vi.hoisted(() => {
  const prisma: any = {
    bulk_import_batches: { findFirst: vi.fn(), update: vi.fn() },
    bulk_import_rows: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    tenant_notes: { create: vi.fn() },
  };
  return {
    mockPrisma: prisma,
    mockLifecycle: { createInvitation: vi.fn() },
    mockRooms: { applyRoomPlan: vi.fn() },
  };
});

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/src/services/tenants/tenant-invitation-lifecycle-service", () => ({
  tenantInvitationLifecycleService: mockLifecycle,
}));
vi.mock("@/src/services/bulk-import/room-import-service", () => mockRooms);
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ sub: "owner-1", role: "OWNER" }),
  apiResponse: (data: any, status = 200) => new Response(JSON.stringify({ data }), { status }),
  apiError: (message: string, code: string, status = 400) =>
    new Response(JSON.stringify({ error: { message, code } }), { status }),
}));

import { POST } from "@/app/api/bulk-import/[batch_id]/confirm/route";

const BATCH_ID = "44444444-4444-4444-4444-444444444444";
const HOSTEL_ID = "11111111-1111-1111-1111-111111111111";
const TOTAL = 60;

/** The whole batch, as rows in the table. */
let rows: any[];

function rowData(n: number) {
  return {
    name: `Tenant ${n}`,
    phone: `+91987650${String(n).padStart(4, "0")}`,
    email: `t${n}@example.com`,
    room_no: "101",
    room_id: "room-101",
    monthly_rent: 8500,
    joining_date: "2026-01-05",
  };
}

function request(body: Record<string, unknown> = {}) {
  return new Request("https://api.test/api/bulk-import/x/confirm", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any;
}

async function confirm(body: Record<string, unknown> = {}) {
  const res = await POST(request(body), { params: { batch_id: BATCH_ID } });
  return (await res.json()).data;
}

beforeEach(() => {
  vi.clearAllMocks();

  rows = Array.from({ length: TOTAL }, (_, i) => ({
    id: `row-${i + 1}`,
    row_number: i + 2,
    mapped_data: rowData(i + 1),
    execution_status: "PENDING",
    tenant_id: null,
    invitation_id: null,
    reservation_id: null,
  }));

  mockPrisma.bulk_import_batches.findFirst.mockResolvedValue({
    id: BATCH_ID,
    owner_id: "owner-1",
    hostel_id: HOSTEL_ID,
    // `hostels`, as the schema has it — a mock answering to `hostel` is what
    // let the wrong name reach production.
    hostels: { id: HOSTEL_ID, name: "Sri Adithya Boys Hostel" },
    import_summary: null,
    validation_errors: {
      defaults: {},
      valid_rows: rows.map((r) => ({ row: r.row_number, data: r.mapped_data })),
      invalid: [],
      duplicates: [],
      requires_historical_join_date_confirmation: false,
    },
  });
  mockPrisma.bulk_import_batches.update.mockResolvedValue({});

  // Stands in for the table, honouring the `where` the code actually sends —
  // if the mock did its own filtering, dropping the query's filter would still
  // look correct and a re-POST could re-invite everyone.
  mockPrisma.bulk_import_rows.findMany.mockImplementation(async ({ where, take }: any) => {
    let match = rows;
    const status = where?.execution_status;
    if (typeof status === "string") match = match.filter((r) => r.execution_status === status);
    else if (status?.not) match = match.filter((r) => r.execution_status !== status.not);
    return match.slice(0, take ?? match.length);
  });
  mockPrisma.bulk_import_rows.count.mockImplementation(async ({ where }: any) => {
    if (where?.execution_status === "SUCCESS") return rows.filter((r) => r.execution_status === "SUCCESS").length;
    if (where?.execution_status === "FAILED") return rows.filter((r) => r.execution_status === "FAILED").length;
    return rows.length;
  });
  mockPrisma.bulk_import_rows.update.mockImplementation(async ({ where, data }: any) => {
    const row = rows.find((r) => r.id === where.id);
    if (row) Object.assign(row, data);
    return row;
  });

  mockPrisma.tenant_notes.create.mockResolvedValue({});
  mockLifecycle.createInvitation.mockResolvedValue({
    tenant_id: "t", invitation_id: "i", reservation_id: "r", email_sent: true,
  });
});

describe("chunked confirm", () => {
  it("processes one chunk and reports what is left", async () => {
    const data = await confirm({ chunk_size: 25 });

    expect(mockLifecycle.createInvitation).toHaveBeenCalledTimes(25);
    expect(data.progress).toMatchObject({ total: 60, processed: 25, remaining: 35, stage: "TENANTS" });
  });

  it("never invites the same tenant twice across chunks", async () => {
    await confirm({ chunk_size: 25 });
    await confirm({ chunk_size: 25 });
    await confirm({ chunk_size: 25 });

    expect(mockLifecycle.createInvitation).toHaveBeenCalledTimes(TOTAL);
    const invited = mockLifecycle.createInvitation.mock.calls.map((c: any[]) => c[0].email);
    expect(new Set(invited).size).toBe(TOTAL);
  });

  it("reports DONE only on the last chunk", async () => {
    expect((await confirm({ chunk_size: 25 })).progress.stage).toBe("TENANTS");
    expect((await confirm({ chunk_size: 25 })).progress.stage).toBe("TENANTS");

    const last = await confirm({ chunk_size: 25 });
    expect(last.progress).toMatchObject({ remaining: 0, processed: 60, succeeded: 60, stage: "DONE" });
  });

  it("keeps the batch PROCESSING while rows remain, and only then completes it", async () => {
    await confirm({ chunk_size: 25 });
    const midway = mockPrisma.bulk_import_batches.update.mock.calls.at(-1)![0].data;
    expect(midway.status).toBe("PROCESSING");
    expect(midway.imported_at).toBeUndefined();

    await confirm({ chunk_size: 25 });
    await confirm({ chunk_size: 25 });
    const final = mockPrisma.bulk_import_batches.update.mock.calls.at(-1)![0].data;
    expect(final.status).toBe("COMPLETED");
    expect(final.imported_at).toBeInstanceOf(Date);
  });

  it("clamps an absurd chunk size rather than trying the whole batch at once", async () => {
    const data = await confirm({ chunk_size: 5000 });
    expect(mockLifecycle.createInvitation).toHaveBeenCalledTimes(25);
    expect(data.progress.remaining).toBe(35);
  });

  it("defaults the chunk size when the client does not ask", async () => {
    await confirm();
    expect(mockLifecycle.createInvitation).toHaveBeenCalledTimes(25);
  });

  it("creates the rooms once, on the first chunk only", async () => {
    mockRooms.applyRoomPlan.mockResolvedValue({ created: 2, updated: 0, errors: [] });
    mockPrisma.bulk_import_batches.findFirst.mockResolvedValue({
      ...(await mockPrisma.bulk_import_batches.findFirst()),
      validation_errors: {
        valid_rows: rows.map((r) => ({ row: r.row_number, data: r.mapped_data })),
        room_plan: { create: [{ room_no: "103", capacity: 2 }], update: [], unchanged: [], issues: [] },
      },
    });

    const first = await confirm({ chunk_size: 25 });
    expect(mockRooms.applyRoomPlan).toHaveBeenCalledTimes(1);
    expect(first.rooms).toMatchObject({ created: 2 });

    // The batch now records the rooms, so a later chunk must not redo them.
    mockPrisma.bulk_import_batches.findFirst.mockResolvedValue({
      ...(await mockPrisma.bulk_import_batches.findFirst()),
      import_summary: { rooms: { created: 2, updated: 0, errors: [] } },
    });
    await confirm({ chunk_size: 25 });
    expect(mockRooms.applyRoomPlan).toHaveBeenCalledTimes(1);
  });

  it("still finishes when more rows fail than a chunk holds", async () => {
    // A FAILED row is already attempted. If the chunk query re-selected it,
    // the failures — which sort first by row number — would refill every
    // later chunk and the client's `remaining > 0` loop would never end.
    mockLifecycle.createInvitation.mockRejectedValue(new Error("VALIDATION_ERROR: nope"));

    const first = await confirm({ chunk_size: 25 });
    expect(first.progress).toMatchObject({ processed: 25, remaining: 35 });

    await confirm({ chunk_size: 25 });
    const last = await confirm({ chunk_size: 25 });

    expect(last.progress).toMatchObject({ remaining: 0, failed: TOTAL, stage: "DONE" });
    expect(mockLifecycle.createInvitation).toHaveBeenCalledTimes(TOTAL);
  });

  it("keeps the rooms it already created when it writes the summary", async () => {
    // The first chunk records the rooms here. Replacing the summary instead of
    // merging into it would make the next chunk create them all over again.
    mockPrisma.bulk_import_batches.update.mockResolvedValue({
      import_summary: { rooms: { created: 2, updated: 0, errors: [] } },
    });

    await confirm({ chunk_size: 25 });

    const written = mockPrisma.bulk_import_batches.update.mock.calls.at(-1)![0].data;
    expect(written.import_summary).toMatchObject({ rooms: { created: 2 } });
  });

  it("marks the batch PARTIAL when some rows failed", async () => {
    mockLifecycle.createInvitation.mockImplementation(async (payload: any) => {
      if (payload.email === "t1@example.com") throw new Error("VALIDATION_ERROR: nope");
      return { tenant_id: "t", invitation_id: "i", reservation_id: "r", email_sent: true };
    });

    await confirm({ chunk_size: 25 });
    await confirm({ chunk_size: 25 });
    await confirm({ chunk_size: 25 });
    await confirm({ chunk_size: 25 });

    const final = mockPrisma.bulk_import_batches.update.mock.calls.at(-1)![0].data;
    expect(final.status).toBe("PARTIAL");
    expect(final.failed_rows).toBe(1);
  });
});

describe("the Notes column reaches the tenant", () => {
  // Notes were parsed, stored on the import row, and then dropped:
  // createInvitation reads no notes key and `tenants` has no notes column.
  it("saves a note the owner wrote against the tenant", async () => {
    rows = [{ ...rows[0], mapped_data: { ...rows[0].mapped_data, notes: "Paid in cash to the warden" } }];

    await confirm({ chunk_size: 1 });

    expect(mockPrisma.tenant_notes.create).toHaveBeenCalledWith({
      data: { tenant_id: "t", owner_id: "owner-1", content: "Paid in cash to the warden" },
    });
  });

  it("writes nothing when the column is blank", async () => {
    rows = [{ ...rows[0], mapped_data: { ...rows[0].mapped_data, notes: "   " } }];
    await confirm({ chunk_size: 1 });
    expect(mockPrisma.tenant_notes.create).not.toHaveBeenCalled();
  });

  it("does not fail the import when the note cannot be saved", async () => {
    rows = [{ ...rows[0], mapped_data: { ...rows[0].mapped_data, notes: "Something" } }];
    mockPrisma.tenant_notes.create.mockRejectedValue(new Error("db down"));

    const data = await confirm({ chunk_size: 1 });

    // The tenancy exists; losing the note must not undo that.
    expect(data.result.success_count).toBe(1);
    expect(data.progress.failed).toBe(0);
  });
});


describe("a tenant in a room the same sheet creates", () => {
  const REAL_ROOM_ID = "99999999-9999-9999-9999-999999999999";

  beforeEach(() => {
    // The owner's import: one tenant in room 401, which the Rooms sheet adds.
    // Validation let the row through against a placeholder, since 401 did not
    // exist yet.
    rows = [
      {
        id: "row-1",
        row_number: 2,
        hostel_id: HOSTEL_ID,
        mapped_data: { ...rowData(1), room_no: "401", room_id: "pending:401" },
        execution_status: "PENDING",
        tenant_id: null,
        invitation_id: null,
        reservation_id: null,
      },
    ];
    mockPrisma.rooms = { findFirst: vi.fn().mockResolvedValue({ id: REAL_ROOM_ID }) };
  });

  /**
   * The placeholder reached `createInvitation` as a room id, and `rooms.id` is
   * a UUID: "Error creating UUID … found `p` at 1". Room 401 had been created
   * a moment earlier; the tenant still failed.
   */
  it("is invited into the room that now exists, not the placeholder", async () => {
    await confirm();

    expect(mockLifecycle.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ room_id: REAL_ROOM_ID }),
      "owner-1"
    );
  });

  it("never hands a placeholder to createInvitation", async () => {
    await confirm();

    expect(mockLifecycle.createInvitation).toHaveBeenCalled();
    for (const [args] of mockLifecycle.createInvitation.mock.calls) {
      expect(String(args.room_id)).not.toMatch(/^pending:/);
    }
  });

  /** Every hostel has a room 101 — the lookup must not leave this one. */
  it("finds the room within this hostel only", async () => {
    await confirm();

    expect(mockPrisma.rooms.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ hostel_id: HOSTEL_ID, is_active: true }),
      })
    );
  });

  it("tells the owner in plain words when the room was never made", async () => {
    mockPrisma.rooms.findFirst.mockResolvedValue(null);

    const data = await confirm();

    expect(mockLifecycle.createInvitation).not.toHaveBeenCalled();
    expect(data.progress.failed).toBe(1);
    expect(data.result.errors[0].error).toMatch(/Room 401 wasn't created/);
    expect(data.result.errors[0].error).not.toMatch(/UUID|prisma/i);
  });

  it("leaves a room that already existed alone", async () => {
    rows[0].mapped_data = rowData(1); // room_id "room-101", a real room

    await confirm();

    expect(mockPrisma.rooms.findFirst).not.toHaveBeenCalled();
    expect(mockLifecycle.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ room_id: "room-101" }),
      "owner-1"
    );
  });
});
