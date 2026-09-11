import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * validateRows behaviour found by the post-implementation code review of the
 * bulk-import tree (2026-09-10). Each block pins one defect that previewed a
 * row as clean and then either failed at confirm or recorded the wrong thing.
 */

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    profile: { findMany: vi.fn() },
    tenants: { findMany: vi.fn() },
    tenant_invitations: { findMany: vi.fn() },
    rooms: { findMany: vi.fn() },
    hostels: { findUnique: vi.fn() },
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

import { bulkImportValidationService } from "@/lib/services/bulk-import-validation-service";
import { parseImportDate } from "@/lib/services/bulk-import/dates";
import * as XLSX from "xlsx";
import { parseImportNumber, parseTenantWorkbook } from "@/lib/services/bulk-import/workbook-parser";

function workbook(rows: Record<string, unknown>[]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Tenants");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const HOSTEL_ID = "11111111-1111-1111-1111-111111111111";
const OWNER_ID = "22222222-2222-2222-2222-222222222222";

function room(room_no: string, over: Record<string, unknown> = {}) {
  return {
    id: `room-${room_no}`,
    room_no,
    is_active: true,
    capacity: 3,
    base_rent: 8500,
    _count: { room_allocations: 0, tenant_invitation_reservations: 0 },
    ...over,
  };
}

let phoneSeq = 0;
function row(over: Record<string, unknown> = {}) {
  phoneSeq += 1;
  return {
    name: "Ravi Kumar",
    phone: `98765${String(phoneSeq).padStart(5, "0")}`,
    email: `tenant${phoneSeq}@example.com`,
    room_no: "101",
    joining_date: "05/01/2026",
    ...over,
  } as any;
}

async function validateOne(over: Record<string, unknown> = {}) {
  const result = await bulkImportValidationService.validateRows([row(over)], HOSTEL_ID, OWNER_ID, {});
  return [...result.validRows, ...result.invalidRows, ...result.duplicates][0];
}

/** DD/MM/YYYY for the first day of the month `offset` months from now. */
function monthsAgo(offset: number) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

beforeEach(() => {
  phoneSeq = 0;
  mockPrisma.profile.findMany.mockResolvedValue([]);
  mockPrisma.tenants.findMany.mockResolvedValue([]);
  mockPrisma.tenant_invitations.findMany.mockResolvedValue([]);
  mockPrisma.hostels.findUnique.mockResolvedValue({ name: "Sri Adithya Boys Hostel" });
  mockPrisma.rooms.findMany.mockResolvedValue([
    room("101"),
    room("102", { is_active: false }),
    room("103", { base_rent: 0 }),
    room("104", { capacity: 1, _count: { room_allocations: 1, tenant_invitation_reservations: 0 } }),
    room("105"),
  ]);
});

describe("the joining date that gets billed is the one that was validated", () => {
  // createInvitation re-parses the stored joining date with `new Date()`,
  // which reads "05/01/2026" US-style as 1 May and an Excel serial as the
  // year 46026. So the stored value must be the validator's own ISO reading.
  it("stores DD/MM/YYYY as ISO, so 05/01/2026 stays 5 January", async () => {
    const r = await validateOne({ joining_date: "05/01/2026" });
    expect(r.data.joining_date).toBe("2026-01-05");
  });

  it("stores a date whose day exceeds 12, which new Date() cannot read at all", async () => {
    const r = await validateOne({ joining_date: "13/01/2026" });
    expect(r.errors).toEqual([]);
    expect(r.data.joining_date).toBe("2026-01-13");
  });

  it("stores an Excel date serial as ISO, not as the year 46026", async () => {
    const r = await validateOne({ joining_date: "46027" });
    const iso = r.data.joining_date ?? "";
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number(iso.slice(0, 4))).toBeGreaterThan(2020);
    expect(Number(iso.slice(0, 4))).toBeLessThan(2100);
  });

  it("round-trips through new Date() to the same calendar day", async () => {
    const r = await validateOne({ joining_date: "05/01/2026" });
    const billed = new Date(r.data.joining_date ?? "");
    expect(billed.getUTCFullYear()).toBe(2026);
    expect(billed.getUTCMonth()).toBe(0);
    expect(billed.getUTCDate()).toBe(5);
  });
});

describe("impossible dates are rejected, not rolled over", () => {
  it.each(["31/02/2026", "12/25/2025", "00/01/2026", "32/01/2026", "2026-13-01"])(
    "rejects %s",
    (value) => {
      expect(parseImportDate(value)).toBeNull();
    }
  );

  it("still accepts a genuine 29 February in a leap year", () => {
    expect(parseImportDate("29/02/2028")).not.toBeNull();
  });

  it("surfaces an impossible date to the owner as an unreadable date", async () => {
    const r = await validateOne({ joining_date: "31/02/2026" });
    expect(r.issues.map((i) => i.code)).toContain("DATE_UNREADABLE");
  });
});

describe("numbers from spreadsheet cells", () => {
  it.each([
    ["8500", 8500],
    ["8,500", 8500],
    ["₹8,500", 8500],
    ["Rs. 8,000", 8000],
    ["Rs 8000", 8000],
    ["INR 12,34,567", 1234567],
    ["8500.50", 8500.5],
    [8500, 8500],
  ])("reads %s as %s", (value, expected) => {
    expect(parseImportNumber(value)).toBe(expected);
  });

  it.each(["", "  ", null, undefined])("treats %s as blank", (value) => {
    expect(parseImportNumber(value)).toBeUndefined();
  });

  it.each(["TBD", "N/A", "1 year", "8k", "--"])("does not read %s as a number", (value) => {
    expect(Number.isNaN(parseImportNumber(value))).toBe(true);
  });

  it("blocks an unreadable rent rather than silently using the room's rent", async () => {
    const r = await validateOne({ monthly_rent: parseImportNumber("TBD") });
    expect(r.issues.map((i) => i.code)).toContain("NUMBER_INVALID");
    expect(r.errors.some((e) => e.field === "monthly_rent")).toBe(true);
  });

  it("blocks a rent of ₹0", async () => {
    const r = await validateOne({ monthly_rent: 0 });
    expect(r.issues.map((i) => i.code)).toContain("NUMBER_INVALID");
  });

  it("blocks an agreement length that isn't whole months", async () => {
    const r = await validateOne({ agreement_duration_months: parseImportNumber("1 year") });
    expect(r.issues.map((i) => i.code)).toContain("NUMBER_INVALID");
  });
});

describe("an unreadable number is shown to the owner as they typed it", () => {
  // The parser turns "TBD" into NaN, so rendering the parsed value would tell
  // the owner that "NaN" isn't a valid rent. The copy must quote the cell.
  it("quotes the original cell text, never NaN", async () => {
    const [parsed] = parseTenantWorkbook(
      workbook([{ Name: "Ravi Kumar", Phone: "9876500001", Email: "r@example.com", Room: "101", "Joining Date": "05/01/2026", "Monthly Rent": "TBD" }]),
      "t.xlsx"
    );
    const result = await bulkImportValidationService.validateRows([parsed], HOSTEL_ID, OWNER_ID, {});
    const issue = result.invalidRows[0].issues.find((i) => i.code === "NUMBER_INVALID")!;
    expect(issue.title).toContain('"TBD"');
    expect(issue.title).not.toMatch(/NaN|undefined/);
  });
});

describe("duplicate copy", () => {
  it('says "row 2", not "rows 2", for a single earlier row', async () => {
    const result = await bulkImportValidationService.validateRows(
      [row({ phone: "9876512345", email: "a@example.com" }), row({ phone: "9876512345", email: "b@example.com" })],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );
    const issue = result.duplicates[0].issues.find((i) => i.code === "DUPLICATE_IN_FILE")!;
    expect(issue.detail).toContain("row 2");
    expect(issue.detail).not.toContain("rows 2");
  });
});

describe("rooms", () => {
  it("blocks an inactive room at preview, since createInvitation refuses it at confirm", async () => {
    const r = await validateOne({ room_no: "102" });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.issues.map((i) => i.code)).toContain("ROOM_INACTIVE");
  });

  it("accepts a room with no base rent when the sheet supplies the tenant's rent", async () => {
    const r = await validateOne({ room_no: "103", monthly_rent: 7000 });
    expect(r.errors).toEqual([]);
    expect(r.data.monthly_rent).toBe(7000);
  });

  it("still blocks a room with no base rent when the sheet has no rent either", async () => {
    const r = await validateOne({ room_no: "103" });
    expect(r.issues.map((i) => i.code)).toContain("ROOM_NO_RENT");
  });

  it("offers rooms that still have a free bed when a room is full", async () => {
    const r = await validateOne({ room_no: "104" });
    const full = r.issues.find((i) => i.code === "ROOM_CAPACITY_EXCEEDED");
    expect(full).toBeDefined();
    expect(full!.fix.options).toContain("101");
    expect(full!.fix.options).not.toContain("104");
    expect(full!.fix.options).not.toContain("102");
  });
});

describe("the capped-backfill notice matches what billing actually does", () => {
  // Billing generates one rent month per month from the joining month to the
  // current month INCLUSIVE, and truncates once that count exceeds 24.
  it("fires when 25 rent months would be billed", async () => {
    const r = await validateOne({ joining_date: monthsAgo(24) });
    expect(r.issues.map((i) => i.code)).toContain("BACKFILL_CAPPED");
  });

  it("does not fire when exactly 24 rent months would be billed", async () => {
    const r = await validateOne({ joining_date: monthsAgo(23) });
    expect(r.issues.map((i) => i.code)).not.toContain("BACKFILL_CAPPED");
  });
});

describe("every blocked row can be explained to the owner", () => {
  // The review queue renders `issues`. A row with a blocking legacy error but
  // no BLOCKER issue would be shown as clean and then fail — so this is an
  // invariant over every validation path, not a per-code test.
  it("gives every row with an error at least one BLOCKER issue", async () => {
    const rows = [
      row({ name: "" }),
      // A blank email is allowed now — only a wrong one blocks.
      row({ email: "not-an-email" }),
      row({ phone: "123" }),
      row({ room_no: "" }),
      row({ room_no: "999" }),
      row({ room_no: "102" }),
      row({ room_no: "103" }),
      row({ room_no: "104" }),
      row({ name: "=HYPERLINK(1)" }),
      row({ joining_date: "May" }),
      row({ monthly_rent: parseImportNumber("TBD") }),
      row({ amount_paid: 5000 }),
    ];
    const result = await bulkImportValidationService.validateRows(rows, HOSTEL_ID, OWNER_ID, {});

    for (const r of result.invalidRows) {
      const blockers = r.issues.filter((i) => i.severity === "BLOCKER");
      expect(blockers.length, `row ${r.row}: ${r.errors.map((e) => e.message).join("; ")}`).toBeGreaterThan(0);
    }
    expect(result.invalidRows.length).toBe(rows.length);
  });

  it("explains a duplicate as a choice, naming the row it repeats", async () => {
    const result = await bulkImportValidationService.validateRows(
      [
        row({ phone: "9876512345", email: "a@example.com" }),
        row({ phone: "9876512345", email: "b@example.com" }),
      ],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );
    const dup = result.duplicates[0];
    const issue = dup.issues.find((i) => i.code === "DUPLICATE_IN_FILE");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("NEEDS_CHOICE");
    expect(issue!.detail).toContain("2");
  });

  it("explains a person already on Stayo as a choice", async () => {
    mockPrisma.tenants.findMany.mockResolvedValue([{ phone_1: "+919876512345", personal_email: "x@example.com", profiles: null }]);
    const r = await validateOne({ phone: "9876512345" });
    expect(r.issues.map((i) => i.code)).toContain("DUPLICATE_IN_SYSTEM");
  });
});

describe("existing tenants are recognised whatever format their phone is stored in", () => {
  // Production stores profiles.phone as bare 10 digits ("9876512345") and
  // tenant_invitations.phone as E.164 ("+919876512345"). An exact Set.has()
  // against the normalised E.164 row phone therefore never matched a profile,
  // so re-importing an existing tenant created a second tenancy.
  it("matches a profile phone stored as bare 10 digits", async () => {
    mockPrisma.tenants.findMany.mockResolvedValue([{ phone_1: "9876512345", personal_email: "x@example.com", profiles: null }]);
    const r = await validateOne({ phone: "+91 98765 12345" });
    expect(r.isDuplicate).toBe(true);
    expect(r.issues.map((i) => i.code)).toContain("DUPLICATE_IN_SYSTEM");
  });

  it("matches an invitation phone stored as E.164", async () => {
    mockPrisma.tenant_invitations.findMany.mockResolvedValue([{ phone: "+919876512345", email: "y@example.com" }]);
    const r = await validateOne({ phone: "9876512345" });
    expect(r.isDuplicate).toBe(true);
  });

  it("does not match a different number that shares a prefix", async () => {
    mockPrisma.tenants.findMany.mockResolvedValue([{ phone_1: "9876512345", personal_email: "x@example.com", profiles: null }]);
    const r = await validateOne({ phone: "9876512346" });
    expect(r.isDuplicate).toBe(false);
  });
});

describe("a tenant may live in a room the same workbook adds", () => {
  // The template tells the owner to add a missing room on the Rooms sheet and
  // then pick it for a tenant. Validating tenants against the database alone
  // would reject the exact flow the template asks for.
  it("accepts a tenant in a room the Rooms sheet will create", async () => {
    const result = await bulkImportValidationService.validateRows(
      [row({ room_no: "301", monthly_rent: 7000 })],
      HOSTEL_ID,
      OWNER_ID,
      {},
      [{ room_no: "301", capacity: 2, base_rent: 7000 }]
    );

    expect(result.validRows).toHaveLength(1);
    expect(result.invalidRows).toEqual([]);
  });

  it("still rejects a room that is in neither the hostel nor the sheet", async () => {
    const result = await bulkImportValidationService.validateRows(
      [row({ room_no: "999" })],
      HOSTEL_ID,
      OWNER_ID,
      {},
      [{ room_no: "301", capacity: 2, base_rent: 7000 }]
    );

    expect(result.invalidRows[0].issues.map((i) => i.code)).toContain("ROOM_NOT_FOUND");
  });

  it("counts beds in a new room, so the sheet cannot overfill it", async () => {
    const result = await bulkImportValidationService.validateRows(
      [
        row({ room_no: "301", monthly_rent: 7000 }),
        row({ room_no: "301", monthly_rent: 7000 }),
        row({ room_no: "301", monthly_rent: 7000 }),
      ],
      HOSTEL_ID,
      OWNER_ID,
      {},
      [{ room_no: "301", capacity: 2, base_rent: 7000 }]
    );

    expect(result.validRows).toHaveLength(2);
    expect(result.invalidRows[0].issues.map((i) => i.code)).toContain("ROOM_CAPACITY_EXCEEDED");
  });

  it("prefers the hostel's own room when the sheet lists one that already exists", async () => {
    const result = await bulkImportValidationService.validateRows(
      [row({ room_no: "101" })],
      HOSTEL_ID,
      OWNER_ID,
      {},
      [{ room_no: "101", capacity: 9, base_rent: 1 }]
    );

    expect(result.validRows[0].data.room_id).toBe("room-101");
  });
});

describe("a former tenant can come back", () => {
  // Duplicate detection used to match every tenant profile the owner had ever
  // had, with no tenancy-status filter — so someone who moved out could never
  // be imported again, though the single-tenant invite adopts them happily and
  // the database already allows only one live tenancy per person.
  it("does not treat a moved-out tenant as a duplicate", async () => {
    mockPrisma.tenants.findMany.mockResolvedValue([]); // no live tenancy
    const r = await validateOne({ phone: "9876512345" });
    expect(r.isDuplicate).toBe(false);
  });

  it("still blocks someone who is living there right now", async () => {
    mockPrisma.tenants.findMany.mockResolvedValue([
      { phone_1: null, personal_email: null, profiles: { phone: "9876512345", email: "x@example.com" } },
    ]);
    const r = await validateOne({ phone: "9876512345" });
    expect(r.isDuplicate).toBe(true);
  });

  it("asks only for tenancies that still hold a bed", async () => {
    await validateOne();
    const where = mockPrisma.tenants.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(["INVITED", "ACTIVE"]);
    expect(where.status.in).not.toContain("FORMER_TENANT");
  });
});

describe("paying more than the tenant owes", () => {
  // createInvitation refuses this at execution, one row at a time, after other
  // rows have already been created. The owner should see it in the preview,
  // with the real figures.
  function monthsBack(n: number) {
    const d = new Date();
    d.setMonth(d.getMonth() - n);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }

  it("blocks an amount well above the dues instead of failing at execution", async () => {
    const r = await validateOne({
      joining_date: monthsBack(1),
      monthly_rent: 8500,
      amount_paid: 500000,
      payment_method: "CASH",
    });

    const issue = r.issues.find((i) => i.code === "OVERPAID");
    expect(issue).toBeDefined();
    // Blocks: the row cannot import until the amount or the date changes.
    expect(issue!.severity).toBe("BLOCKER");
    expect(issue!.detail).toContain("5,00,000");
  });

  it("accepts an amount within the dues", async () => {
    const r = await validateOne({
      joining_date: monthsBack(2),
      monthly_rent: 8500,
      amount_paid: 8500,
      payment_method: "CASH",
    });

    expect(r.issues.map((i) => i.code)).not.toContain("OVERPAID");
  });

  it("says nothing when no amount was paid", async () => {
    const r = await validateOne({ joining_date: monthsBack(2), monthly_rent: 8500 });
    expect(r.issues.map((i) => i.code)).not.toContain("OVERPAID");
  });
});

describe('email is optional', () => {
  // createInvitation requires a name, a phone and a room — not an email — and
  // the invitation goes out over WhatsApp. Demanding one here blocked rows the
  // rest of the system would have accepted.
  it('accepts a tenant with no email at all', async () => {
    const r = await validateOne({ email: '' });
    expect(r.errors).toEqual([]);
    expect(r.issues.map((i) => i.code)).not.toContain('EMAIL_INVALID');
  });

  it('accepts a whitespace-only email cell', async () => {
    const r = await validateOne({ email: '   ' });
    expect(r.errors).toEqual([]);
  });

  it('still rejects an email that was typed wrong', async () => {
    // Given one, it has to be usable — a typo is worse than a blank.
    const r = await validateOne({ email: 'ravi@gmail' });
    expect(r.issues.map((i) => i.code)).toContain('EMAIL_INVALID');
  });

  it('does not treat two blank emails as the same person', async () => {
    const result = await bulkImportValidationService.validateRows(
      [row({ email: '' }), row({ email: '' })],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );

    expect(result.duplicates).toEqual([]);
    expect(result.validRows).toHaveLength(2);
  });

  it('still catches a genuine duplicate email', async () => {
    const result = await bulkImportValidationService.validateRows(
      [row({ email: 'same@example.com' }), row({ email: 'same@example.com' })],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );

    expect(result.duplicates).toHaveLength(1);
  });

  it('still requires the phone, which is how the invitation reaches them', async () => {
    const r = await validateOne({ email: '', phone: '' });
    expect(r.issues.map((i) => i.code)).toContain('PHONE_INVALID');
  });
});

describe("a real generated workbook with the email cell left blank", () => {
  // Mirrors what an owner actually does: download the template, type over the
  // example row, leave Email empty. This goes through the real parser rather
  // than a hand-built row object.
  it("parses and validates without complaining about the missing email", async () => {
    const { buildImportWorkbook } = await import("@/lib/services/bulk-import/template-builder");
    const { parseTenantWorkbook, TENANTS_SHEET } = await import("@/lib/services/bulk-import/workbook-parser");
    const XLSX = await import("xlsx");

    const buf = await buildImportWorkbook({
      hostel: { id: HOSTEL_ID, name: "Sri Adithya Boys Hostel" },
      dueDay: 5,
      rooms: [{ room_no: "101", floor: 1, capacity: 3, room_type: "Triple", base_rent: 8500, occupied_count: 0 }],
      tenantCount: 0,
    });

    // Type over the example row, exactly as the owner did — Email left blank.
    const wb = XLSX.read(buf, { type: "buffer", raw: true });
    const sheet = wb.Sheets[TENANTS_SHEET];
    sheet["A2"] = { t: "s", v: "Locus" };
    sheet["B2"] = { t: "s", v: "8008046952" };
    delete sheet["C2"];
    sheet["D2"] = { t: "s", v: "101" };
    const edited = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const rows = parseTenantWorkbook(edited, "tenant-import.xlsx");
    const result = await bulkImportValidationService.validateRows(rows, HOSTEL_ID, OWNER_ID, {});

    expect(result.invalidRows).toEqual([]);
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0].data.name).toBe("Locus");
    expect(result.summary.blockers).toBe(0);
  });
});

describe("a date typed into a real spreadsheet, not a text cell", () => {
  // LibreOffice and Excel turn a typed date into a date-formatted cell, which
  // SheetJS hands back as a fractional serial like "46276.00011574074" — not
  // the text the owner sees. Nothing tested that path before.
  it.each([
    ["46276", "a whole serial"],
    ["46276.00011574074", "a serial carrying a time fraction"],
    ["46276.999", "a serial just short of midnight"],
  ])("reads %s (%s) as a real date", (value) => {
    const parsed = parseImportDate(value);
    expect(parsed).not.toBeNull();
    expect(parsed!.getFullYear()).toBe(2026);
    expect(parsed!.getMonth()).toBe(8);
    expect(parsed!.getDate()).toBe(11);
  });

  it("stores it as ISO, the same as a typed date", async () => {
    const r = await validateOne({ joining_date: "46276.00011574074" });
    expect(r.data.joining_date).toBe("2026-09-11");
  });
});

describe("a phone number written the way people write it", () => {
  // "+91 80080 46952" is how a great many people write an Indian mobile. The
  // formula guard keyed on the leading character alone, so it told owners
  // their phone cell "contains a formula" — an error with no possible fix,
  // because the number was right.
  it.each(["+918008046952", "+91 80080 46952", "+91-80080-46952"])(
    "accepts %s without calling it a formula",
    async (phone) => {
      const r = await validateOne({ phone });
      expect(r.issues.map((i) => i.code)).not.toContain("FORMULA_IN_CELL");
      expect(r.errors).toEqual([]);
      expect(r.data.phone).toBe("+918008046952");
    }
  );

  it("still refuses a cell that would actually execute", async () => {
    const r = await validateOne({ name: "=SUM(A1:A2)" });
    expect(r.issues.map((i) => i.code)).toContain("FORMULA_IN_CELL");
  });

  it("still refuses the classic injection payload", async () => {
    // A leading minus followed by anything but number punctuation.
    const r = await validateOne({ notes: "-cmd|'/c calc'!A0" });
    expect(r.issues.map((i) => i.code)).toContain("FORMULA_IN_CELL");
  });

  it("still refuses a cell reference behind a plus", async () => {
    const r = await validateOne({ name: "+A1" });
    expect(r.issues.map((i) => i.code)).toContain("FORMULA_IN_CELL");
  });
});

describe("dates the owner reported as rejected", () => {
  /**
   * An owner saw "2026-09-11 isn't a full date" — the date our own default
   * generates — beside "2026-01-01 isn't a full date" on the row. Neither is
   * reproducible: both are the ISO form the parser has accepted since the
   * service was a single file. These pin that, so the day a change breaks ISO
   * the suite says so instead of an owner discovering it mid-import.
   */
  it("accepts the joining date our own default produces", async () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;

    const result = await bulkImportValidationService.validateRows(
      [row({ joining_date: "" })],
      HOSTEL_ID,
      OWNER_ID,
      { joining_date: iso }
    );
    const only = [...result.validRows, ...result.invalidRows, ...result.duplicates][0];

    expect(only.issues.map((i: any) => i.code)).not.toContain("DATE_UNREADABLE");
  });

  it.each(["2026-09-11", "2026-01-01", "2026-1-1"])("accepts %s on the row", async (joining_date) => {
    const result = await validateOne({ joining_date });

    expect(result.issues.map((i: any) => i.code)).not.toContain("DATE_UNREADABLE");
    expect(result.data.joining_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("still refuses a date that is not one", async () => {
    const result = await validateOne({ joining_date: "next monday" });

    expect(result.issues.map((i: any) => i.code)).toContain("DATE_UNREADABLE");
  });
});
