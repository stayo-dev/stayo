/**
 * Confirm puts the owner's tenant details on the tenancy it just created
 * (2026-10-10). Real confirm route; the database, the invitation lifecycle and
 * auth are faked — same harness as `bulk-import-chunked-confirm.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const { mockPrisma, mockLifecycle, mockRooms } = vi.hoisted(() => {
  const prisma: any = {
    bulk_import_batches: { findFirst: vi.fn(), update: vi.fn() },
    bulk_import_rows: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    tenant_notes: { create: vi.fn() },
    tenants: { update: vi.fn() },
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

const WITH_DETAILS = {
  name: "Akhil Reddy",
  phone: "+919876543210",
  email: "",
  room_no: "101",
  room_id: "room-101",
  monthly_rent: 8500,
  joining_date: "2026-10-01",
  guardian_name: "Ramesh Reddy",
  guardian_phone: "91234 00001",
  // Not import columns any more: an old file may still carry them, and they
  // must not be written.
  gender: "male",
  profile_type: "Student",
  guardian_relation: "Father",
};
const PLAIN = { name: "Ravi", phone: "+919876500002", email: "", room_no: "101", room_id: "room-101", monthly_rent: 8500, joining_date: "2026-10-01" };

let rows: any[];

function seed(data: any[]) {
  rows = data.map((d, i) => ({
    id: `row-${i + 1}`,
    row_number: i + 2,
    hostel_id: HOSTEL_ID,
    mapped_data: d,
    execution_status: "PENDING",
    tenant_id: null,
  }));
  mockPrisma.bulk_import_batches.findFirst.mockResolvedValue({
    id: BATCH_ID,
    owner_id: "owner-1",
    hostel_id: HOSTEL_ID,
    hostels: { id: HOSTEL_ID, name: "Sri Adithya" },
    import_summary: null,
    validation_errors: {
      defaults: {},
      valid_rows: rows.map((r) => ({ row: r.row_number, data: r.mapped_data })),
      invalid: [],
      duplicates: [],
      requires_historical_join_date_confirmation: false,
    },
  });
}

async function confirm() {
  const req = new Request("https://api.test/api/bulk-import/x/confirm", { method: "POST", body: "{}" }) as any;
  const res = await POST(req, { params: { batch_id: BATCH_ID } });
  return (await res.json()).data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.bulk_import_batches.update.mockResolvedValue({});
  mockPrisma.bulk_import_rows.findMany.mockImplementation(async ({ where, take }: any) =>
    rows.filter((r) => !where?.execution_status || r.execution_status === where.execution_status).slice(0, take ?? rows.length),
  );
  mockPrisma.bulk_import_rows.count.mockImplementation(async ({ where }: any) =>
    where?.execution_status ? rows.filter((r) => r.execution_status === where.execution_status).length : rows.length,
  );
  mockPrisma.bulk_import_rows.update.mockImplementation(async ({ where, data }: any) => {
    const row = rows.find((r) => r.id === where.id);
    Object.assign(row, data);
    return row;
  });
  mockPrisma.tenants.update.mockResolvedValue({});
  mockPrisma.tenant_notes.create.mockResolvedValue({});
  let n = 0;
  mockLifecycle.createInvitation.mockImplementation(async () => {
    n += 1;
    return { tenant_id: `tenant-${n}`, invitation_id: `inv-${n}`, reservation_id: `res-${n}`, queued: true };
  });
});

describe("confirm writes the owner's details onto the new tenancy", () => {
  it("only the guardian name and phone, normalised as onboarding stores them, on the tenancy createInvitation returned", async () => {
    seed([WITH_DETAILS]);
    await confirm();
    expect(mockPrisma.tenants.update).toHaveBeenCalledTimes(1);
    const { where, data } = mockPrisma.tenants.update.mock.calls[0][0];
    expect(where).toEqual({ id: "tenant-1" });
    expect(data).toEqual({
      guardian_name: "Ramesh Reddy",
      guardian_phone: "+919123400001",
      phone_2: "+919123400001",
    });
    expect(rows[0].execution_status).toBe("SUCCESS");
  });

  it("createInvitation receives exactly what it did before — the single-invite path is unchanged", async () => {
    seed([WITH_DETAILS]);
    await confirm();
    const sent = mockLifecycle.createInvitation.mock.calls[0][0];
    for (const key of ["guardian_name", "guardian_phone"]) {
      expect(sent).not.toHaveProperty(key);
    }
    expect(sent).toMatchObject({ name: "Akhil Reddy", room_id: "room-101", dispatch: "DEFERRED", batch_id: BATCH_ID });
  });

  it("a row with no details writes nothing extra", async () => {
    seed([PLAIN]);
    await confirm();
    expect(mockPrisma.tenants.update).not.toHaveBeenCalled();
    expect(rows[0].execution_status).toBe("SUCCESS");
  });

  it("a details write that fails never fails the import — the row says so, the tenant fills them in", async () => {
    seed([WITH_DETAILS, PLAIN]);
    mockPrisma.tenants.update.mockRejectedValueOnce(new Error("db hiccup"));
    const data = await confirm();
    expect(rows.map((r) => r.execution_status)).toEqual(["SUCCESS", "SUCCESS"]);
    expect(rows[0].error_message).toMatch(/Tenant details from the sheet were not saved/);
    expect(data.progress.remaining).toBe(0);
  });

  it("a row whose invitation fails gets no details written", async () => {
    seed([WITH_DETAILS]);
    mockLifecycle.createInvitation.mockRejectedValueOnce(new Error("VALIDATION_ERROR: Room is full"));
    await confirm();
    expect(mockPrisma.tenants.update).not.toHaveBeenCalled();
    expect(rows[0].execution_status).toBe("FAILED");
  });

  it("a retried confirm neither re-invites nor re-writes a row already done", async () => {
    seed([WITH_DETAILS, PLAIN]);
    await confirm();
    await confirm();
    expect(mockLifecycle.createInvitation).toHaveBeenCalledTimes(2);
    expect(mockPrisma.tenants.update).toHaveBeenCalledTimes(1);
  });
});

describe("wiring that the behaviour depends on", () => {
  const ACTIVATION = readFileSync("src/services/tenants/activation-workflow-service.ts", "utf8");
  const LIFECYCLE = readFileSync("src/services/tenants/tenant-invitation-lifecycle-service.ts", "utf8");

  it("onboarding's guardian check is the one function that knows about imports", () => {
    // The activation context and the GUARDIAN step both decide "ask for an
    // OTP?" through isGuardianPhoneVerifiedForTenant — so the import rule
    // reaches both, and the screen and the validation cannot disagree.
    expect(ACTIVATION).toMatch(/guardianVerified = gPhone\s*\?\s*await isGuardianPhoneVerifiedForTenant\(tenant\.id, gPhone\)/);
    expect(ACTIVATION).toMatch(/const alreadyVerified = await isGuardianPhoneVerifiedForTenant\(tenant\.id, guardianPhone\)/);
  });

  it("onboarding still asks every tenant for their date of birth and photo, and the agreement step is untouched", () => {
    expect(ACTIVATION).toContain('if (!tenant.date_of_birth) missingTier1.push("date_of_birth");');
    expect(ACTIVATION).toContain('if (!tenant.photo_url) missingTier1.push("photo_url");');
    expect(ACTIVATION).not.toMatch(/bulk_import|isGuardianSuppliedByOwnerImport[\s\S]{0,400}agreement\.update/);
  });

  it("the guardian's activation notice is sent once, at activation, only for an import-supplied guardian the tenant never saved", () => {
    const fn = ACTIVATION.slice(ACTIVATION.indexOf("private async announceImportedGuardian"), ACTIVATION.indexOf("private async activate("));
    expect(fn).toContain("isGuardianSuppliedByOwnerImport(tenant.id, guardianPhone)");
    expect(fn).toContain('event_type: "guardian_saved"');
    // Called inside the branch that only runs when activation matched one row.
    const branch = ACTIVATION.slice(ACTIVATION.indexOf("if (tenantUpdate.count !== 1)"), ACTIVATION.indexOf('await eventSystem.trigger("tenant_onboarding_completed"'));
    expect(branch).toContain("this.announceImportedGuardian(tenantNow)");
  });

  it("the single-invite path (createInvitation) knows nothing about imported details", () => {
    expect(LIFECYCLE).not.toMatch(/guardian_name|date_of_birth|tenantPrefillData|profile-fields/);
  });
});
