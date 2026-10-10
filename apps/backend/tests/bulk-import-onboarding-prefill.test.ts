/**
 * Bulk import carries the tenant's details through to onboarding (2026-10-10).
 *
 * An owner can now give each tenant's date of birth, gender, tenant type,
 * and guardian in the import workbook. Onboarding
 * already prefills from the tenancy record, so these land there; a guardian
 * the owner supplied with a name and number for this tenancy skips the
 * guardian OTP — keyed to the import row, never to a number merely being on
 * file. Only `@/lib/db`, the billing defaults and the WhatsApp normaliser are
 * faked; everything else is the real code.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    profile: { findMany: vi.fn() },
    tenants: { findMany: vi.fn() },
    tenant_invitations: { findMany: vi.fn() },
    rooms: { findMany: vi.fn() },
    hostels: { findUnique: vi.fn() },
    phoneVerificationOtp: { findFirst: vi.fn() },
    bulk_import_rows: { findMany: vi.fn() },
  } as any,
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/services/hostel-billing-preferences-service", () => ({
  hostelBillingPreferencesService: {
    getBillingDefaults: vi.fn().mockResolvedValue({
      maintenance_type: "NONE",
      maintenance_charge: 0,
      security_deposit: 0,
      advance_deposit: 0,
    }),
  },
}));
vi.mock("@/lib/services/notifications/providers/whatsapp/meta-provider", () => ({
  normalizeWhatsAppPhone: (value: string) => {
    const digits = String(value).replace(/\D/g, "").slice(-10);
    if (digits.length !== 10) throw new Error("bad phone");
    return `91${digits}`;
  },
}));

import { normalizeIndianPhone as onboardingNormalize } from "@/lib/utils/phone-utils";
import {
  guardianSuppliedByImport,
  normalizeIndianPhone,
  normalizeProfileFields,
  PROFILE_HEADERS,
  profileProblems,
  readProfileCells,
  tenantPrefillData,
} from "@/lib/services/bulk-import/profile-fields";
import { sanitizeImportRowForStorage } from "@/lib/services/bulk-import/sanitize-row";
import { parseTenantWorkbook } from "@/lib/services/bulk-import/workbook-parser";
import { buildImportWorkbook } from "@/lib/services/bulk-import/template-builder";
import { bulkImportValidationService } from "@/lib/services/bulk-import-validation-service";
import {
  isGuardianPhoneVerifiedForTenant,
  isGuardianSuppliedByOwnerImport,
} from "@/src/services/tenants/guardian-verification-store";

const TODAY = new Date(2026, 9, 10);
const HOSTEL_ID = "11111111-1111-1111-1111-111111111111";
const OWNER_ID = "22222222-2222-2222-2222-222222222222";

// ── The columns ─────────────────────────────────────────────────────────────

describe("the workbook columns", () => {
  it("adds the onboarding details after the existing columns, in this order", () => {
    expect(PROFILE_HEADERS).toEqual([
      "Date of Birth",
      "Gender",
      "Tenant Type",
      "Guardian Name",
      "Guardian Phone",
      "Guardian Relation",
    ]);
  });

  it("a template the owner fills in round-trips through the parser", async () => {
    const buffer = await buildImportWorkbook({
      hostel: { id: HOSTEL_ID, name: "Sri Adithya" },
      dueDay: 5,
      rooms: [{ room_no: "101", floor: 1, capacity: 3, room_type: null, base_rent: 8500, occupied_count: 0 }],
      tenantCount: 0,
      tenants: [
        {
          name: "Akhil Reddy",
          phone: "9876543210",
          room_no: "101",
          date_of_birth: "15/08/2004",
          gender: "Male",
          profile_type: "Student",
          guardian_name: "Ramesh Reddy",
          guardian_phone: "9876500001",
          guardian_relation: "Father",
        },
      ],
    });
    const [row] = parseTenantWorkbook(buffer, "import.xlsx");
    expect(row).toMatchObject({
      name: "Akhil Reddy",
      date_of_birth: "15/08/2004",
      gender: "Male",
      profile_type: "Student",
      guardian_name: "Ramesh Reddy",
      guardian_phone: "9876500001",
      guardian_relation: "Father",
    });
  });

  it("the blank template's example row carries the new columns and is still skipped", async () => {
    const buffer = await buildImportWorkbook({
      hostel: { id: HOSTEL_ID, name: "Sri Adithya" },
      dueDay: 5,
      rooms: [{ room_no: "101", floor: 1, capacity: 3, room_type: null, base_rent: 8500, occupied_count: 0 }],
      tenantCount: 0,
    });
    const sheet = XLSX.read(buffer, { type: "buffer" }).Sheets.Tenants;
    const [header, example] = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    expect(header.slice(15)).toEqual(PROFILE_HEADERS);
    expect(example[15]).toBe("15/08/2004");
    expect(() => parseTenantWorkbook(buffer, "t.xlsx")).toThrow(/doesn't have any tenants/);
  });

  it("accepts owners' own spellings of the headers", () => {
    expect(readProfileCells({ DOB: "01/01/2003", "Parent Phone": "9876500002", Relation: "Mother" })).toEqual({
      date_of_birth: "01/01/2003",
      guardian_phone: "9876500002",
      guardian_relation: "Mother",
    });
  });

  it("does not read college, course, roll number, company, office, job role or address — the tenant gives those", () => {
    expect(
      readProfileCells({
        College: "ABC", Course: "BSc", "Roll Number": "R1", Company: "Infosys", "Office Location": "HYD", "Job Role": "Dev",
        "Permanent Address": "12 MG Road", Address: "Pune",
      }),
    ).toEqual({});
  });

  it("blank cells are simply absent — the tenant fills those in", () => {
    expect(readProfileCells({ Gender: "  ", "Date of Birth": "" })).toEqual({});
  });
});

// ── Validation mirrors onboarding ──────────────────────────────────────────

describe("profileProblems — only values onboarding itself would accept", () => {
  const ctx = { tenantPhone: "+919876543210", today: TODAY };
  const codes = (fields: Record<string, string>) => profileProblems(fields, ctx).map((p) => p.code);

  it("accepts a complete, valid set", () => {
    expect(
      codes({ date_of_birth: "15/08/2004", gender: "female", profile_type: "Working Professional", guardian_phone: "+91 98765 00001" }),
    ).toEqual([]);
  });

  it.each([
    ["31/02/2004", "an impossible date"],
    ["11/10/2026", "a date in the future"],
    ["01/01/1899", "before 1900"],
    ["sometime in 2004", "not a date"],
  ])("rejects a date of birth that is %s (%s)", (dob) => {
    expect(codes({ date_of_birth: dob })).toEqual(["DOB_INVALID"]);
  });

  it("rejects a gender or tenant type outside onboarding's options", () => {
    expect(codes({ gender: "Boy?" })).toEqual(["GENDER_INVALID"]);
    expect(codes({ profile_type: "Retired" })).toEqual(["TENANT_TYPE_INVALID"]);
  });

  it("rejects a guardian number that isn't a mobile, or is the tenant's own", () => {
    expect(codes({ guardian_phone: "12345" })).toEqual(["GUARDIAN_PHONE_INVALID"]);
    expect(codes({ guardian_phone: "1234567890" })).toEqual(["GUARDIAN_PHONE_INVALID"]); // must start 6–9
    expect(codes({ guardian_phone: "98765 43210" })).toEqual(["GUARDIAN_PHONE_IS_TENANT"]);
  });

  it("rejects over-long text", () => {
    expect(codes({ guardian_name: "x".repeat(201) })).toEqual(["TEXT_TOO_LONG"]);
    expect(codes({ guardian_relation: "x".repeat(200) })).toEqual([]);
  });
});

describe("the guardian phone rule matches onboarding's exactly", () => {
  it.each([
    "9876500001", "+91 98765 00001", "919876500001", "0919876500001", "09876500001", "+91-98765-00001",
    "5876500001", "1234567890", "98765", "", "abc", "98765000011", "+1 415 555 0100",
  ])("%s", (input) => {
    expect(normalizeIndianPhone(input)).toBe(onboardingNormalize(input));
  });
});

describe("what lands on the tenancy", () => {
  it("is normalised exactly as onboarding stores it", () => {
    expect(
      normalizeProfileFields(
        { date_of_birth: "15/08/2004", gender: "m", profile_type: "student", guardian_phone: "98765 00001", guardian_name: " Ramesh " },
        TODAY,
      ),
    ).toEqual({ date_of_birth: "2004-08-15", gender: "Male", profile_type: "STUDENT", guardian_phone: "+919876500001", guardian_name: "Ramesh" });
  });

  it("writes the guardian phone to both columns onboarding reads", () => {
    const data = tenantPrefillData({ guardian_name: "Ramesh", guardian_phone: "+919876500001", guardian_relation: "Father" });
    expect(data).toEqual({ guardian_name: "Ramesh", guardian_relation: "Father", guardian_phone: "+919876500001", phone_2: "+919876500001" });
  });

  it("never writes college, course, roll number, company, office, job role or address", () => {
    const sneaked = { college_name: "ABC", course: "BSc", roll_number: "R1", office_name: "Infosys", office_location: "HYD", job_role: "Dev", permanent_address: "Pune" } as any;
    expect(tenantPrefillData(normalizeProfileFields({ ...sneaked, profile_type: "Student" }, TODAY))).toEqual({ profile_type: "STUDENT" });
  });

  it("never touches agreement, signature, acceptance, activation, completion or documents", () => {
    const data = tenantPrefillData({
      date_of_birth: "2004-08-15", gender: "Male", profile_type: "STUDENT", guardian_name: "R", guardian_phone: "+919876500001",
      guardian_relation: "Father",
    });
    const forbidden = /agreement|signature|signed|accept|status|activation|profile_completed|document|photo|verified/i;
    expect(Object.keys(data).filter((k) => forbidden.test(k))).toEqual([]);
  });

  it("writes nothing for a row with no details", () => {
    expect(tenantPrefillData(normalizeProfileFields({}, TODAY))).toEqual({});
  });
});

describe("storage keeps what the owner typed", () => {
  it("an invalid value is stored as typed, so a re-check still blocks the row", () => {
    const stored = sanitizeImportRowForStorage({ name: "A", phone: "9876543210", email: "", room_no: "101", date_of_birth: "31/02/2004", gender: " Male " } as any);
    expect(stored.date_of_birth).toBe("31/02/2004");
    expect(stored.gender).toBe("Male");
  });
});

// ── Validation, end to end through validateRows ─────────────────────────────

let phoneSeq = 0;
function row(over: Record<string, unknown> = {}) {
  phoneSeq += 1;
  return {
    name: "Ravi Kumar",
    phone: `98765${String(phoneSeq).padStart(5, "0")}`,
    email: `tenant${phoneSeq}@example.com`,
    room_no: "101",
    joining_date: "05/10/2026",
    ...over,
  } as any;
}

describe("validateRows with the new columns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.profile.findMany.mockResolvedValue([]);
    mockPrisma.tenants.findMany.mockResolvedValue([]);
    mockPrisma.tenant_invitations.findMany.mockResolvedValue([]);
    mockPrisma.rooms.findMany.mockResolvedValue([
      { id: "room-101", room_no: "101", is_active: true, capacity: 5, base_rent: 8500, _count: { room_allocations: 0, tenant_invitation_reservations: 0 } },
    ]);
    mockPrisma.hostels.findUnique.mockResolvedValue({ name: "Sri Adithya", preferences_config: {} });
  });

  const validate = (rows: any[]) => bulkImportValidationService.validateRows(rows, HOSTEL_ID, OWNER_ID, {});

  it("a row with valid details imports, carrying them", async () => {
    const result = await validate([
      row({ date_of_birth: "15/08/2004", gender: "Male", guardian_name: "Ramesh", guardian_phone: "9123400001", guardian_relation: "Father" }),
    ]);
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0].data).toMatchObject({ guardian_name: "Ramesh", guardian_phone: "9123400001" });
  });

  it("validation itself catches a guardian who is the tenant", async () => {
    const result = await validate([row({ phone: "9988776655", guardian_name: "Self", guardian_phone: "+91 99887 76655" })]);
    expect(result.invalidRows[0].issues.map((i) => i.code)).toContain("GUARDIAN_PHONE_IS_TENANT");
  });

  it("a row with no details at all imports exactly as before", async () => {
    const result = await validate([row()]);
    expect(result.validRows).toHaveLength(1);
    expect(result.invalidRows).toHaveLength(0);
  });

  it("an invalid detail blocks only its own row, with an issue on that field", async () => {
    const result = await validate([row({ date_of_birth: "31/02/2004" }), row()]);
    expect(result.validRows).toHaveLength(1);
    expect(result.invalidRows).toHaveLength(1);
    const issue = result.invalidRows[0].issues.find((i) => i.code === "DOB_INVALID");
    expect(issue).toMatchObject({ severity: "BLOCKER", field: "date_of_birth" });
  });

  it("a blocked row claims no bed", async () => {
    mockPrisma.rooms.findMany.mockResolvedValue([
      { id: "room-101", room_no: "101", is_active: true, capacity: 1, base_rent: 8500, _count: { room_allocations: 0, tenant_invitation_reservations: 0 } },
    ]);
    const result = await validate([row({ gender: "nope" }), row()]);
    expect(result.validRows).toHaveLength(1);
  });

  it("college, office and address columns in an owner's own sheet are ignored, not validated or stored", async () => {
    const result = await validate([row({ roll_number: "SAME", college_name: "x".repeat(500), permanent_address: "x".repeat(900) }), row({ roll_number: "SAME" })]);
    expect(result.validRows).toHaveLength(2);
  });

  it("a formula in a detail cell is refused like any other", async () => {
    const result = await validate([row({ guardian_name: "=A1" })]);
    expect(result.invalidRows[0].issues.map((i) => i.code)).toContain("FORMULA_IN_CELL");
  });
});

// ── The guardian OTP rule ───────────────────────────────────────────────────

describe("guardianSuppliedByImport — provenance, not presence", () => {
  const ok = { execution_status: "SUCCESS", mapped_data: { guardian_name: "Ramesh", guardian_phone: "9876500001" } };

  it("is true for this tenancy's executed import row with name and the same number", () => {
    expect(guardianSuppliedByImport([ok], "+919876500001")).toBe(true);
    expect(guardianSuppliedByImport([ok], "919876500001")).toBe(true);
  });

  it("is false when the tenant entered a different number", () => {
    expect(guardianSuppliedByImport([ok], "9876500999")).toBe(false);
  });

  it("is false when the import row has a number but no guardian name", () => {
    expect(guardianSuppliedByImport([{ ...ok, mapped_data: { guardian_phone: "9876500001" } }], "9876500001")).toBe(false);
  });

  it("is false for a row that did not import", () => {
    expect(guardianSuppliedByImport([{ ...ok, execution_status: "FAILED" }], "9876500001")).toBe(false);
    expect(guardianSuppliedByImport([{ ...ok, execution_status: "PENDING" }], "9876500001")).toBe(false);
  });

  it("is false with no import row at all — a guardian on file is not enough", () => {
    expect(guardianSuppliedByImport([], "9876500001")).toBe(false);
    expect(guardianSuppliedByImport([ok], "")).toBe(false);
  });
});

describe("isGuardianPhoneVerifiedForTenant — what onboarding asks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.phoneVerificationOtp.findFirst.mockResolvedValue(null);
    mockPrisma.bulk_import_rows.findMany.mockResolvedValue([]);
  });

  it("an OTP proof still counts, without looking at imports", async () => {
    mockPrisma.phoneVerificationOtp.findFirst.mockResolvedValue({ id: "otp" });
    expect(await isGuardianPhoneVerifiedForTenant("t-1", "9876500001")).toBe(true);
    expect(mockPrisma.bulk_import_rows.findMany).not.toHaveBeenCalled();
  });

  it("an Excel-supplied guardian skips the OTP — for its own tenancy only", async () => {
    mockPrisma.bulk_import_rows.findMany.mockImplementation(async ({ where }: any) =>
      where.tenant_id === "t-1" && where.execution_status === "SUCCESS"
        ? [{ execution_status: "SUCCESS", mapped_data: { guardian_name: "Ramesh", guardian_phone: "9876500001" } }]
        : [],
    );
    expect(await isGuardianPhoneVerifiedForTenant("t-1", "9876500001")).toBe(true);
    expect(await isGuardianPhoneVerifiedForTenant("t-2", "9876500001")).toBe(false);
  });

  it("a manually-invited tenant with a guardian on file and no OTP still needs the OTP", async () => {
    // No import row for this tenancy: the number merely existing decides nothing.
    expect(await isGuardianPhoneVerifiedForTenant("manual-1", "9876500001")).toBe(false);
  });

  it("a guardian the tenant changes during onboarding goes back to the OTP flow", async () => {
    mockPrisma.bulk_import_rows.findMany.mockResolvedValue([
      { execution_status: "SUCCESS", mapped_data: { guardian_name: "Ramesh", guardian_phone: "9876500001" } },
    ]);
    expect(await isGuardianPhoneVerifiedForTenant("t-1", "9876500777")).toBe(false);
  });

  it("isGuardianSuppliedByOwnerImport refuses a missing tenancy or number without querying", async () => {
    expect(await isGuardianSuppliedByOwnerImport("", "9876500001")).toBe(false);
    expect(await isGuardianSuppliedByOwnerImport("t-1", null)).toBe(false);
    expect(mockPrisma.bulk_import_rows.findMany).not.toHaveBeenCalled();
  });
});
