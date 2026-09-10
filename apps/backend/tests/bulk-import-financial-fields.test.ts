import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma, mockLifecycle } = vi.hoisted(() => {
  const prisma: any = {
    bulk_import_batches: { findFirst: vi.fn(), update: vi.fn() },
    // `findMany` is mocked from the start even though the current
    // implementation reads rows from the batch's JSON: Task 8 switches the
    // execution source to this table, and these tests must survive that.
    bulk_import_rows: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  };
  return {
    mockPrisma: prisma,
    mockLifecycle: { createInvitation: vi.fn() },
  };
});

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/src/services/tenants/tenant-invitation-lifecycle-service", () => ({
  tenantInvitationLifecycleService: mockLifecycle,
}));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ sub: "owner-1", role: "OWNER" }),
  apiResponse: (data: any, status = 200) =>
    new Response(JSON.stringify({ data }), { status }),
  apiError: (message: string, code: string, status = 400) =>
    new Response(JSON.stringify({ error: { message, code } }), { status }),
}));

import { POST } from "@/app/api/bulk-import/[batch_id]/confirm/route";

const BATCH_ID = "44444444-4444-4444-4444-444444444444";

const IMPORTED_ROW = {
  row: 2,
  data: {
    name: "Ravi Kumar",
    phone: "+919876500001",
    email: "ravi@example.com",
    room_no: "101",
    room_id: "33333333-3333-3333-3333-333333333333",
    monthly_rent: 8500,
    advance_deposit: 25500,
    maintenance_charge: 500,
    maintenance_type: "MONTHLY",
    agreement_duration_months: 11,
    joining_date: "2026-01-05",
    amount_paid: 76500,
    amount_includes_deposit: true,
    payment_method: "CASH",
    notes: "",
  },
  warnings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.bulk_import_batches.findFirst.mockResolvedValue({
    id: BATCH_ID,
    hostel_id: HOSTEL_ID_FOR_TEST(),
    owner_id: "owner-1",
    hostel: { id: HOSTEL_ID_FOR_TEST(), name: "Sri Adithya Boys Hostel" },
    validation_errors: {
      defaults: {},
      valid_rows: [IMPORTED_ROW],
      invalid: [],
      duplicates: [],
      requires_historical_join_date_confirmation: false,
    },
  });
  mockPrisma.bulk_import_batches.update.mockResolvedValue({});
  mockPrisma.bulk_import_rows.findFirst.mockResolvedValue(null);
  mockPrisma.bulk_import_rows.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.bulk_import_rows.update.mockResolvedValue({});
  mockPrisma.bulk_import_rows.findMany.mockResolvedValue([
    {
      id: "row-uuid-1",
      row_number: 2,
      mapped_data: IMPORTED_ROW.data,
      execution_status: "PENDING",
      tenant_id: null,
      invitation_id: null,
      reservation_id: null,
    },
  ]);
  mockLifecycle.createInvitation.mockResolvedValue({
    tenant_id: "t1",
    invitation_id: "i1",
    reservation_id: "r1",
    email_sent: true,
  });
});

function HOSTEL_ID_FOR_TEST() {
  return "11111111-1111-1111-1111-111111111111";
}

function confirmRequest(body: Record<string, unknown> = {}) {
  return new Request("https://api.test/api/bulk-import/x/confirm", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any;
}

describe("confirm passes every financial term to createInvitation", () => {
  it("does not drop maintenance", async () => {
    await POST(confirmRequest(), { params: { batch_id: BATCH_ID } });

    expect(mockLifecycle.createInvitation).toHaveBeenCalledTimes(1);
    const [payload] = mockLifecycle.createInvitation.mock.calls[0];
    expect(payload.maintenance_charge).toBe(500);
    expect(payload.maintenance_type).toBe("MONTHLY");
  });

  it("does not drop the amount already paid", async () => {
    await POST(confirmRequest(), { params: { batch_id: BATCH_ID } });

    const [payload] = mockLifecycle.createInvitation.mock.calls[0];
    expect(payload.paid_amount).toBe(76500);
    expect(payload.amount_includes_deposit).toBe(true);
    expect(payload.payment_method).toBe("CASH");
  });

  it("does not drop the agreement duration", async () => {
    await POST(confirmRequest(), { params: { batch_id: BATCH_ID } });

    const [payload] = mockLifecycle.createInvitation.mock.calls[0];
    expect(payload.agreement_duration_months).toBe(11);
  });

  it("still passes the terms it already handled", async () => {
    await POST(confirmRequest(), { params: { batch_id: BATCH_ID } });

    const [payload] = mockLifecycle.createInvitation.mock.calls[0];
    expect(payload.name).toBe("Ravi Kumar");
    expect(payload.room_id).toBe("33333333-3333-3333-3333-333333333333");
    expect(payload.monthly_rent).toBe(8500);
    expect(payload.advance_deposit).toBe(25500);
    expect(payload.joining_date).toBe("2026-01-05");
  });
});

describe("billing_start_mode is gone", () => {
  it("is not part of the payload sent to createInvitation", async () => {
    await POST(confirmRequest(), { params: { batch_id: BATCH_ID } });

    const [payload] = mockLifecycle.createInvitation.mock.calls[0];
    expect(payload).not.toHaveProperty("billing_start_mode");
  });

  it("is not referenced anywhere in the bulk-import tree", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const roots = [
      join(process.cwd(), "app/api/bulk-import"),
      join(process.cwd(), "lib/services"),
    ];
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (full.endsWith(".ts")) {
          if (readFileSync(full, "utf8").includes("billing_start_mode")) {
            offenders.push(full);
          }
        }
      }
    }

    for (const root of roots) walk(root);
    expect(offenders).toEqual([]);
  });
});
