import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The review screen renders `issues`. They used to exist only in the immediate
 * upload response — reload the page, or come back to a batch later, and every
 * row looked clean. The blocker/choice counts were computed and thrown away.
 */

const { mockPrisma, mockValidation } = vi.hoisted(() => {
  const tx: any = {
    bulk_import_batches: { create: vi.fn(), update: vi.fn() },
    bulk_import_rows: { create: vi.fn(), deleteMany: vi.fn() },
  };
  return {
    mockPrisma: {
      hostels: { findFirst: vi.fn() },
      bulk_import_batches: { findFirst: vi.fn() },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
      __tx: tx,
    } as any,
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

import { POST as REVALIDATE } from "@/app/api/bulk-import/revalidate/route";
import { GET as BATCH_PREVIEW } from "@/app/api/bulk-import/[batch_id]/confirm/route";

const HOSTEL_ID = "11111111-1111-1111-1111-111111111111";
const BATCH_ID = "44444444-4444-4444-4444-444444444444";

const PHONE_ISSUE = {
  code: "PHONE_INVALID",
  severity: "BLOCKER",
  row: 2,
  title: '"98765" isn\'t a 10-digit mobile number.',
  detail: "Enter 10 digits.",
  fix: { kind: "EDIT_FIELD" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.hostels.findFirst.mockResolvedValue({ id: HOSTEL_ID, name: "Sri Adithya Boys Hostel" });
  mockPrisma.bulk_import_batches.findFirst.mockResolvedValue({ id: BATCH_ID, validation_errors: null });
  mockValidation.bulkImportValidationService.validateRows.mockResolvedValue({
    totalRows: 1,
    validRows: [],
    invalidRows: [
      { row: 2, data: { name: "Ravi" }, errors: [{ row: 2, field: "phone", message: "bad" }], warnings: [], issues: [PHONE_ISSUE], isDuplicate: false },
    ],
    duplicates: [],
    summary: { valid: 0, invalid: 1, duplicates: 0, warnings: 0, blockers: 1, choices: 0 },
  });
});

function revalidateRequest() {
  return new Request("https://api.test/api/bulk-import/revalidate", {
    method: "POST",
    body: JSON.stringify({ rows: [{ name: "Ravi" }], hostel_id: HOSTEL_ID }),
  }) as any;
}

describe("issues survive a reload", () => {
  it("stores each row's issues on the batch", async () => {
    await REVALIDATE(revalidateRequest());

    const stored = mockPrisma.__tx.bulk_import_batches.create.mock.calls[0][0].data.validation_errors;
    expect(stored.invalid[0].issues.map((i: any) => i.code)).toEqual(["PHONE_INVALID"]);
  });

  it("stores the blocker and choice counts", async () => {
    await REVALIDATE(revalidateRequest());

    const stored = mockPrisma.__tx.bulk_import_batches.create.mock.calls[0][0].data.validation_errors;
    expect(stored.summary).toMatchObject({ blockers: 1, choices: 0 });
  });

  it("returns the counts in the upload response too", async () => {
    const res = await REVALIDATE(revalidateRequest());
    const { data } = await res.json();
    expect(data.validation).toMatchObject({ blockers: 1, choices: 0 });
  });

  it("serves them back when the owner returns to the batch", async () => {
    mockPrisma.bulk_import_batches.findFirst.mockResolvedValue({
      id: BATCH_ID,
      owner_id: "owner-1",
      hostel_id: HOSTEL_ID,
      // The relation is `hostels`. A mock that answers to `hostel` was how the
      // wrong name survived review — see tests/bulk-import-query-shapes.test.ts.
      hostels: { id: HOSTEL_ID, name: "Sri Adithya Boys Hostel" },
      total_rows: 1,
      valid_rows: 0,
      failed_rows: 1,
      duplicate_rows: 0,
      validation_errors: {
        valid_rows: [],
        invalid: [{ row: 2, data: { name: "Ravi" }, errors: [], warnings: [], issues: [PHONE_ISSUE] }],
        duplicates: [],
        summary: { blockers: 1, choices: 0, warnings: 0 },
      },
    });

    const res = await BATCH_PREVIEW(new Request("https://api.test/x") as any, { params: { batch_id: BATCH_ID } });
    const { data } = await res.json();

    expect(data.validation).toMatchObject({ blockers: 1, choices: 0 });
    expect(data.preview.invalid[0].issues[0].code).toBe("PHONE_INVALID");
  });

  it("does not pretend there are zero blockers for an older batch that stored none", async () => {
    mockPrisma.bulk_import_batches.findFirst.mockResolvedValue({
      id: BATCH_ID,
      owner_id: "owner-1",
      hostel_id: HOSTEL_ID,
      hostels: { id: HOSTEL_ID, name: "H" },
      total_rows: 1,
      valid_rows: 0,
      failed_rows: 1,
      duplicate_rows: 0,
      validation_errors: { valid_rows: [], invalid: [], duplicates: [] },
    });

    const res = await BATCH_PREVIEW(new Request("https://api.test/x") as any, { params: { batch_id: BATCH_ID } });
    const { data } = await res.json();
    // No summary stored: the count is 0 but failed_rows still tells the truth.
    expect(data.validation.blockers).toBe(0);
    expect(data.validation.invalid_rows).toBe(1);
  });
});
