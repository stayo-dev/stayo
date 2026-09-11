import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Editing rows must not leave a trail of tenant data behind.
 *
 * Revalidate used to create a new batch on every edit, orphaning the previous
 * one with a full copy of every tenant's name, phone and email in
 * `validation_errors`. A dozen edits left a dozen copies.
 */

const { mockPrisma, mockValidation } = vi.hoisted(() => {
  const tx: any = {
    bulk_import_batches: { create: vi.fn(), update: vi.fn() },
    bulk_import_rows: { create: vi.fn(), deleteMany: vi.fn() },
  };
  const prisma: any = {
    hostels: { findFirst: vi.fn() },
    bulk_import_batches: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
    __tx: tx,
  };
  return {
    mockPrisma: prisma,
    mockValidation: { bulkImportValidationService: { validateRows: vi.fn() } },
  };
});

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/services/bulk-import-validation-service", () => mockValidation);
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ sub: "owner-1", role: "OWNER" }),
  apiResponse: (data: any, status = 200) => new Response(JSON.stringify({ data }), { status }),
  apiError: (message: string, code: string, status = 400) =>
    new Response(JSON.stringify({ error: { message, code } }), { status }),
}));

import { POST } from "@/app/api/bulk-import/revalidate/route";

const HOSTEL_ID = "11111111-1111-1111-1111-111111111111";
const BATCH_ID = "44444444-4444-4444-4444-444444444444";

const ROW = { name: "Ravi Kumar", phone: "+919876500001", email: "r@example.com", room_no: "101" };

function request(body: Record<string, unknown>) {
  return new Request("https://api.test/api/bulk-import/revalidate", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.hostels.findFirst.mockResolvedValue({ id: HOSTEL_ID, name: "Sri Adithya Boys Hostel" });
  mockPrisma.bulk_import_batches.findFirst.mockResolvedValue({ id: BATCH_ID, validation_errors: null });
  mockValidation.bulkImportValidationService.validateRows.mockResolvedValue({
    totalRows: 1,
    validRows: [{ row: 2, data: ROW, errors: [], warnings: [], issues: [], isDuplicate: false }],
    invalidRows: [],
    duplicates: [],
    summary: { valid: 1, invalid: 0, duplicates: 0, warnings: 0, blockers: 0, choices: 0 },
  });
});

describe("revalidating an edited batch", () => {
  it("updates the batch in place instead of orphaning it with a copy of the tenants", async () => {
    await POST(request({ rows: [ROW], hostel_id: HOSTEL_ID, batch_id: BATCH_ID }));

    expect(mockPrisma.__tx.bulk_import_batches.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.__tx.bulk_import_batches.create).not.toHaveBeenCalled();
  });

  it("replaces the previous rows rather than adding to them", async () => {
    await POST(request({ rows: [ROW], hostel_id: HOSTEL_ID, batch_id: BATCH_ID }));

    expect(mockPrisma.__tx.bulk_import_rows.deleteMany).toHaveBeenCalledWith({
      where: { batch_id: BATCH_ID },
    });
  });

  it("still creates a batch when the client is not editing one", async () => {
    await POST(request({ rows: [ROW], hostel_id: HOSTEL_ID }));

    expect(mockPrisma.__tx.bulk_import_batches.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.__tx.bulk_import_batches.update).not.toHaveBeenCalled();
  });

  it("refuses to edit a batch belonging to someone else", async () => {
    mockPrisma.bulk_import_batches.findFirst.mockResolvedValue(null);

    const res = await POST(request({ rows: [ROW], hostel_id: HOSTEL_ID, batch_id: BATCH_ID }));
    expect(res.status).toBe(404);
    expect(mockPrisma.__tx.bulk_import_batches.update).not.toHaveBeenCalled();
  });
});

describe("what an edit must not destroy", () => {
  it("carries the Rooms plan through, since the workbook is gone", async () => {
    mockPrisma.bulk_import_batches.findFirst.mockResolvedValue({
      id: BATCH_ID,
      validation_errors: { room_plan: { create: [{ room_no: "301", capacity: 2 }], update: [], unchanged: [], issues: [] } },
    });

    await POST(request({ rows: [ROW], hostel_id: HOSTEL_ID, batch_id: BATCH_ID }));

    const written = mockPrisma.__tx.bulk_import_batches.update.mock.calls[0][0].data;
    expect(written.validation_errors.room_plan.create[0].room_no).toBe("301");
  });

  it("refuses to edit a batch that has already started creating tenants", async () => {
    // The lookup is scoped to VALIDATED, so an executing batch simply is not
    // found — its rows are the record that stops a re-POST double-inviting.
    mockPrisma.bulk_import_batches.findFirst.mockResolvedValue(null);

    const res = await POST(request({ rows: [ROW], hostel_id: HOSTEL_ID, batch_id: BATCH_ID }));
    expect(res.status).toBe(404);
    expect(mockPrisma.__tx.bulk_import_rows.deleteMany).not.toHaveBeenCalled();
  });

  it("only ever looks for a VALIDATED batch", async () => {
    await POST(request({ rows: [ROW], hostel_id: HOSTEL_ID, batch_id: BATCH_ID }));
    expect(mockPrisma.bulk_import_batches.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "VALIDATED" }) })
    );
  });
});


describe("the rooms the sheet is about to add", () => {
  const withPlan = (create: any[]) =>
    mockPrisma.bulk_import_batches.findFirst.mockResolvedValue({
      id: BATCH_ID,
      validation_errors: {
        room_plan: { create, update: [{ id: "r1" }], unchanged: ["101"], issues: [] },
      },
    });

  /**
   * The bug this pins: upload accepted a tenant in room 401 because the same
   * workbook's Rooms sheet creates it, then the very next re-check called that
   * room unknown — the owner saw "Room 401 not found" beside "your sheet also
   * adds 1 room" and had no move that would satisfy both.
   */
  it("is known to the re-check, not just the upload", async () => {
    withPlan([{ room_no: "401", capacity: 3, base_rent: 6500 }]);

    await POST(request({ rows: [ROW], hostel_id: HOSTEL_ID, batch_id: BATCH_ID }));

    const pending = mockValidation.bulkImportValidationService.validateRows.mock.calls[0][4];
    expect(pending).toEqual([{ room_no: "401", capacity: 3, base_rent: 6500 }]);
  });

  it("survives a plan written without capacity or rent", async () => {
    withPlan([{ room_no: "402" }]);

    await POST(request({ rows: [ROW], hostel_id: HOSTEL_ID, batch_id: BATCH_ID }));

    expect(mockValidation.bulkImportValidationService.validateRows.mock.calls[0][4]).toEqual([
      { room_no: "402", capacity: undefined, base_rent: undefined },
    ]);
  });

  it("does not throw on a batch stored before room plans existed", async () => {
    mockPrisma.bulk_import_batches.findFirst.mockResolvedValue({
      id: BATCH_ID,
      validation_errors: { valid_rows: [] },
    });

    const res = await POST(request({ rows: [ROW], hostel_id: HOSTEL_ID, batch_id: BATCH_ID }));

    expect(res.status).toBe(200);
    expect(mockValidation.bulkImportValidationService.validateRows.mock.calls[0][4]).toEqual([]);
  });

  it("reports the plan back, so the review screen keeps saying rooms are coming", async () => {
    withPlan([{ room_no: "401", capacity: 3 }]);

    const res = await POST(request({ rows: [ROW], hostel_id: HOSTEL_ID, batch_id: BATCH_ID }));
    const body = await res.json();

    expect(body.data.rooms).toEqual({ to_create: 1, to_update: 1, unchanged: 1, issues: [] });
  });

  it("omits rooms entirely when there is no plan, rather than reporting zero", async () => {
    // The client merges this over the upload's result. A zeroed `rooms` would
    // erase a banner that is still true.
    const res = await POST(request({ rows: [ROW], hostel_id: HOSTEL_ID }));
    const body = await res.json();

    expect(body.data).not.toHaveProperty("rooms");
  });
});

describe("the owner's import defaults", () => {
  const withDefaults = (defaults: any) =>
    mockPrisma.bulk_import_batches.findFirst.mockResolvedValue({
      id: BATCH_ID,
      validation_errors: { defaults },
    });

  /**
   * Defaults are collected once, at upload. The client does not resend them,
   * so falling back to `{}` made the default joining date today — quietly
   * changing how many months of back-rent every row generates, because the
   * owner corrected a phone number.
   */
  it("survive an edit, rather than resetting the joining date to today", async () => {
    withDefaults({ joining_date: "2026-01-01", monthly_rent: 6500 });

    await POST(request({ rows: [ROW], hostel_id: HOSTEL_ID, batch_id: BATCH_ID }));

    expect(mockValidation.bulkImportValidationService.validateRows.mock.calls[0][3]).toEqual({
      joining_date: "2026-01-01",
      monthly_rent: 6500,
    });
  });

  it("yield to defaults the client does send", async () => {
    withDefaults({ joining_date: "2026-01-01" });

    await POST(
      request({
        rows: [ROW],
        hostel_id: HOSTEL_ID,
        batch_id: BATCH_ID,
        import_defaults: { joining_date: "2026-02-01" },
      })
    );

    expect(mockValidation.bulkImportValidationService.validateRows.mock.calls[0][3]).toEqual({
      joining_date: "2026-02-01",
    });
  });

  it("are written back, so the next edit still has them", async () => {
    withDefaults({ joining_date: "2026-01-01" });

    await POST(request({ rows: [ROW], hostel_id: HOSTEL_ID, batch_id: BATCH_ID }));

    const written = mockPrisma.__tx.bulk_import_batches.update.mock.calls[0][0].data;
    expect(written.validation_errors.defaults).toEqual({ joining_date: "2026-01-01" });
  });
});
