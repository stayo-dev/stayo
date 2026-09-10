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
      // Confirm is chunked: it counts the batch's rows to report progress and
      // to decide when the batch is genuinely finished.
      count: vi.fn(),
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
  // One row in the batch, and after the run it has succeeded.
  mockPrisma.bulk_import_rows.count.mockImplementation(async ({ where }: any) =>
    where?.execution_status === "FAILED" ? 0 : 1
  );
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
  it("does not drop maintenance — and sends the key the service reads", async () => {
    await POST(confirmRequest(), { params: { batch_id: BATCH_ID } });

    expect(mockLifecycle.createInvitation).toHaveBeenCalledTimes(1);
    const [payload] = mockLifecycle.createInvitation.mock.calls[0];
    // createInvitation reads `data.maintenance_amount`; `maintenance_charge`
    // is only accepted by the separate edit path. A payload-key-only
    // assertion on `maintenance_charge` would stay green even if the route
    // sent the wrong key to this service — see the source-guard test below,
    // which catches that class of drop directly.
    expect(payload.maintenance_amount).toBe(500);
    expect(payload.maintenance_charge).toBeUndefined();
    expect(payload.maintenance_type).toBe("MONTHLY");
  });

  it("does not drop the amount already paid", async () => {
    await POST(confirmRequest(), { params: { batch_id: BATCH_ID } });

    const [payload] = mockLifecycle.createInvitation.mock.calls[0];
    expect(payload.paid_amount).toBe(76500);
    expect(payload.payment_method).toBe("CASH");
    // createInvitation never reads amount_includes_deposit — settlement is
    // plain FIFO over all dues including the deposit. Forwarding an ignored
    // key is exactly the billing_start_mode defect removed above; it stays
    // parsed and stored (TenantImportRow, both sanitizers) for a later
    // plan's workbook, but must not reach this payload.
    expect(payload).not.toHaveProperty("amount_includes_deposit");
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

describe("row bookkeeping", () => {
  it("updates the row by its primary key, not by email+phone", async () => {
    // `findMany` is already stubbed in beforeEach with row-uuid-1.
    await POST(confirmRequest(), { params: { batch_id: BATCH_ID } });

    expect(mockPrisma.bulk_import_rows.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "row-uuid-1" } })
    );
    expect(mockPrisma.bulk_import_rows.updateMany).not.toHaveBeenCalled();
  });
});

describe("payload keys the confirm route sends are keys the service reads", () => {
  it("every data.<field> the route maps into the createInvitation payload is referenced by tenant-invitation-lifecycle-service.ts", async () => {
    // A payload-key assertion (e.g. `payload.maintenance_amount`) only
    // proves the confirm route SENT that key — not that the service reads
    // it under that name. The maintenance_charge/maintenance_amount defect
    // was invisible to exactly that kind of assertion. This test reads both
    // source files as text and cross-checks them directly, following the
    // precedent in tests/whatsapp-prisma-accessors.test.ts and
    // tests/hostel-identity-field-round-trip.test.ts.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const routeSource = readFileSync(
      join(process.cwd(), "app/api/bulk-import/[batch_id]/confirm/route.ts"),
      "utf8"
    );
    const serviceSource = readFileSync(
      join(process.cwd(), "src/services/tenants/tenant-invitation-lifecycle-service.ts"),
      "utf8"
    );

    const callMatch = routeSource.match(
      /tenantInvitationLifecycleService\.createInvitation\(\{([\s\S]*?)\},\s*ownerId\)/
    );
    expect(callMatch).not.toBeNull();
    const callBody = callMatch![1];

    // Every `<payloadKey>: data.<rowField>` line in the call — this is
    // exactly the shape a field-name drop takes, so it is exactly what this
    // guard walks.
    const sentKeys = Array.from(callBody.matchAll(/^\s*(\w+):\s*data\.\w+,?\s*$/gm)).map(
      (m) => m[1]
    );
    expect(sentKeys.length).toBeGreaterThan(5);

    // `notes` is a pre-existing, separate gap: createInvitation never reads
    // `data.notes` at all (unrelated to this batch's fix — flagged in the
    // fix report, not fixed here). Excluded so this guard stays scoped to
    // the class of bug it exists to catch.
    const checked = sentKeys.filter((key) => key !== "notes");

    const unread = checked.filter((key) => !serviceSource.includes(`data.${key}`));
    expect(unread).toEqual([]);
  });
});

describe("sanitizeImportRowForStorage — the storage hop both routes share", () => {
  it("survives every financial field, not just the ones a test happens to mock", async () => {
    // Task 8 switched execution to bulk_import_rows.mapped_data, which the
    // tests above mock directly — nothing above exercises the actual
    // persistence hop this function performs. Re-trimming its allowlist
    // tomorrow would leave the suite green and restore the original bug.
    const { sanitizeImportRowForStorage } = await import(
      "@/lib/services/bulk-import/sanitize-row"
    );

    const row = {
      name: "Ravi Kumar",
      phone: "+919876500001",
      email: "ravi@example.com",
      room_no: "101",
      room_id: "33333333-3333-3333-3333-333333333333",
      monthly_rent: 8500,
      advance_deposit: 25500,
      security_deposit: 25500,
      maintenance_charge: 500,
      maintenance_type: "MONTHLY",
      agreement_duration_months: 11,
      amount_paid: 76500,
      amount_includes_deposit: true,
      payment_method: "CASH",
      payment_reference: "REF-1",
      joining_date: "2026-01-05",
      rent_source: "SHEET",
      notes: "some note",
    } as const;

    const stored = sanitizeImportRowForStorage(row as any);

    expect(stored.name).toBe("Ravi Kumar");
    expect(stored.phone).toBe("+919876500001");
    expect(stored.email).toBe("ravi@example.com");
    expect(stored.room_no).toBe("101");
    expect(stored.room_id).toBe("33333333-3333-3333-3333-333333333333");
    expect(stored.monthly_rent).toBe(8500);
    expect(stored.advance_deposit).toBe(25500);
    expect(stored.security_deposit).toBe(25500);
    expect(stored.maintenance_charge).toBe(500);
    expect(stored.maintenance_type).toBe("MONTHLY");
    expect(stored.agreement_duration_months).toBe(11);
    expect(stored.amount_paid).toBe(76500);
    expect(stored.amount_includes_deposit).toBe(true);
    expect(stored.payment_method).toBe("CASH");
    expect(stored.payment_reference).toBe("REF-1");
    expect(stored.joining_date).toBe("2026-01-05");
    expect(stored.rent_source).toBe("SHEET");
    expect(stored.notes).toBe("some note");
  });

  it("is the one copy both upload/route.ts and revalidate/route.ts import", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    for (const routePath of [
      "app/api/bulk-import/upload/route.ts",
      "app/api/bulk-import/revalidate/route.ts",
    ]) {
      const source = readFileSync(join(process.cwd(), routePath), "utf8");
      expect(source).toContain(
        'import { sanitizeImportRowForStorage } from "@/lib/services/bulk-import/sanitize-row"'
      );
      expect(source).not.toMatch(/function sanitizeImportRowForStorage/);
    }
  });
});
