import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildIssue,
  severityOf,
  groupIssuesByCode,
  ISSUE_CODES,
  type RowIssue,
} from "@/lib/services/bulk-import/issues";

const { mockPrisma } = vi.hoisted(() => {
  const prisma: any = {
    profile: { findMany: vi.fn() },
    tenants: { findMany: vi.fn() },
    tenant_invitations: { findMany: vi.fn() },
    rooms: { findMany: vi.fn() },
    hostels: { findUnique: vi.fn() },
  };
  return { mockPrisma: prisma };
});

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

beforeEach(() => {
  mockPrisma.profile.findMany.mockResolvedValue([]);
  mockPrisma.tenants.findMany.mockResolvedValue([]);
  mockPrisma.tenant_invitations.findMany.mockResolvedValue([]);
  mockPrisma.rooms.findMany.mockResolvedValue([
    {
      id: "33333333-3333-3333-3333-333333333333",
      room_no: "101",
      is_active: true,
      capacity: 3,
      base_rent: 8500,
      _count: { room_allocations: 0, tenant_invitation_reservations: 0 },
    },
  ]);
  mockPrisma.hostels.findUnique.mockResolvedValue({ name: "Sri Adithya Boys Hostel" });
});

describe("severity", () => {
  it("blocks rows that cannot import", () => {
    expect(severityOf("ROOM_NOT_FOUND")).toBe("BLOCKER");
    expect(severityOf("PHONE_INVALID")).toBe("BLOCKER");
    expect(severityOf("PAYMENT_METHOD_MISSING")).toBe("BLOCKER");
  });

  it("lets the owner decide on capped backfill and overpayment", () => {
    expect(severityOf("BACKFILL_CAPPED")).toBe("NEEDS_CHOICE");
    expect(severityOf("OVERPAID")).toBe("NEEDS_CHOICE");
    expect(severityOf("DUPLICATE_IN_SYSTEM")).toBe("NEEDS_CHOICE");
  });
});

describe("copy", () => {
  it("names the actual room and hostel", () => {
    const issue = buildIssue("ROOM_NOT_FOUND", 7, {
      roomNo: "1O1",
      hostelName: "Sri Adithya Boys Hostel",
      nearestRooms: ["101", "102"],
    });

    expect(issue.title).toContain("1O1");
    expect(issue.title).toContain("Sri Adithya Boys Hostel");
    expect(issue.fix.kind).toBe("PICK_ROOM");
    expect(issue.fix.options).toEqual(["101", "102"]);
    expect(issue.row).toBe(7);
  });

  it("names the actual rupee amounts for an overpayment", () => {
    const issue = buildIssue("OVERPAID", 4, {
      amountPaid: 90000,
      amountOwed: 76500,
      joiningDate: "2026-01-05",
    });

    expect(issue.detail).toContain("90,000");
    expect(issue.detail).toContain("76,500");
    expect(issue.detail).toContain("13,500");
    expect(issue.severity).toBe("NEEDS_CHOICE");
  });

  it("asks for dates in Indian format", () => {
    const issue = buildIssue("DATE_UNREADABLE", 3, { value: "May" });

    expect(issue.detail).toContain("DD/MM/YYYY");
    expect(issue.detail).not.toContain("YYYY-MM-DD");
    expect(issue.detail).toContain("5 January 2026");
  });

  it("says how many months will be billed when backfill is capped", () => {
    const issue = buildIssue("BACKFILL_CAPPED", 9, {
      monthsElapsed: 32,
      cappedTo: 24,
      firstBilledMonth: "October 2023",
    });

    expect(issue.detail).toContain("32");
    expect(issue.detail).toContain("24");
    expect(issue.detail).toContain("October 2023");
    expect(issue.fix.kind).toBe("ACKNOWLEDGE");
  });

  it("never renders a bare code", () => {
    const codes = ISSUE_CODES;

    for (const code of codes) {
      const issue = buildIssue(code, 2, {});
      expect(issue.title.length).toBeGreaterThan(10);
      expect(issue.title).not.toContain("_");
      expect(issue.title).not.toBe(code);
    }
  });
});

describe("grouping", () => {
  it("collects repeated codes so the owner decides once", () => {
    const issues: RowIssue[] = [
      buildIssue("BACKFILL_CAPPED", 2, { monthsElapsed: 30, cappedTo: 24 }),
      buildIssue("BACKFILL_CAPPED", 3, { monthsElapsed: 31, cappedTo: 24 }),
      buildIssue("PHONE_INVALID", 4, { value: "98765" }),
    ];

    const groups = groupIssuesByCode(issues);
    const capped = groups.find((g) => g.code === "BACKFILL_CAPPED");

    expect(capped).toBeDefined();
    expect(capped!.rows).toEqual([2, 3]);
    expect(groups).toHaveLength(2);
  });
});

describe("copy for blank or missing values", () => {
  it("says a blank mobile number is missing, not that \"\" is invalid", () => {
    const issue = buildIssue("PHONE_INVALID", 5, { value: "" });

    expect(issue.title).not.toContain('""');
    expect(issue.title.toLowerCase()).toContain("missing");
  });

  it("says a blank joining date is missing, not that \"\" is unreadable", () => {
    const issue = buildIssue("DATE_UNREADABLE", 5, { value: "  " });

    expect(issue.title).not.toMatch(/"\s*"/);
    expect(issue.title.toLowerCase()).toContain("missing");
  });

  it("does not claim ₹0 was paid when the amount is unknown", () => {
    const issue = buildIssue("PAYMENT_METHOD_MISSING", 5, {});

    expect(issue.title).not.toContain("₹0");
  });

  it("still names the amount when it is known, in lakh grouping", () => {
    const issue = buildIssue("PAYMENT_METHOD_MISSING", 5, { amountPaid: 1234567 });

    expect(issue.title).toContain("₹12,34,567");
  });
});

describe("group titles", () => {
  it("does not reuse one row's specific title for the whole group", () => {
    const groups = groupIssuesByCode([
      buildIssue("ROOM_NOT_FOUND", 2, { roomNo: "1O1", hostelName: "Sri Adithya Boys Hostel" }),
      buildIssue("ROOM_NOT_FOUND", 3, { roomNo: "305", hostelName: "Sri Adithya Boys Hostel" }),
      buildIssue("ROOM_NOT_FOUND", 4, { roomNo: "G9", hostelName: "Sri Adithya Boys Hostel" }),
    ]);

    const group = groups.find((g) => g.code === "ROOM_NOT_FOUND")!;
    expect(group.title).not.toContain("1O1");
    expect(group.title).toContain("3");
  });

  it("keeps the row's own specific title when the group has one row", () => {
    const groups = groupIssuesByCode([
      buildIssue("ROOM_NOT_FOUND", 2, { roomNo: "1O1", hostelName: "Sri Adithya Boys Hostel" }),
    ]);

    expect(groups[0].title).toContain("1O1");
  });

  it("gives every code a group title with no developer vocabulary", () => {
    const codes = ISSUE_CODES;

    for (const code of codes) {
      const [group] = groupIssuesByCode([buildIssue(code, 2, {}), buildIssue(code, 3, {})]);
      expect(group.title).not.toContain("_");
      expect(group.title).not.toMatch(/undefined|NaN/);
      expect(group.title.length).toBeGreaterThan(10);
    }
  });
});

describe("validateRows emits issues", () => {
  const HOSTEL_ID = "11111111-1111-1111-1111-111111111111";
  const OWNER_ID = "22222222-2222-2222-2222-222222222222";

  it("reports a bad phone as a PHONE_INVALID blocker", async () => {
    const { bulkImportValidationService } = await import(
      "@/lib/services/bulk-import-validation-service"
    );

    const result = await bulkImportValidationService.validateRows(
      [{ name: "Ravi", phone: "98765", email: "ravi@example.com", room_no: "101", joining_date: "2026-09-01" } as any],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );

    const row = result.invalidRows[0];
    expect(row.issues.map((i) => i.code)).toContain("PHONE_INVALID");
    expect(row.issues.find((i) => i.code === "PHONE_INVALID")!.severity).toBe("BLOCKER");
    expect(row.issues.find((i) => i.code === "PHONE_INVALID")!.title).toContain("98765");
  });

  it("counts blockers and choices separately", async () => {
    const { bulkImportValidationService } = await import(
      "@/lib/services/bulk-import-validation-service"
    );

    const result = await bulkImportValidationService.validateRows(
      [
        { name: "Ravi", phone: "98765", email: "ravi@example.com", room_no: "101", joining_date: "2026-09-01" } as any,
        { name: "Priya", phone: "9876500002", email: "priya@example.com", room_no: "101", joining_date: "2022-01-05" } as any,
      ],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );

    expect(result.summary.blockers).toBe(1);
    expect(result.summary.choices).toBeGreaterThanOrEqual(1);
  });

  it("blocks a row that already-paid an amount but named no payment method", async () => {
    const { bulkImportValidationService } = await import(
      "@/lib/services/bulk-import-validation-service"
    );

    const result = await bulkImportValidationService.validateRows(
      [
        {
          name: "Ravi",
          phone: "9876500003",
          email: "ravi.paid@example.com",
          room_no: "101",
          joining_date: "2026-09-01",
          amount_paid: 5000,
        } as any,
      ],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );

    const row = result.invalidRows[0];
    expect(row).toBeDefined();
    expect(row.issues.map((i) => i.code)).toContain("PAYMENT_METHOD_MISSING");
    expect(row.issues.find((i) => i.code === "PAYMENT_METHOD_MISSING")!.severity).toBe("BLOCKER");
    // The legacy errors array must also carry a blocker for this row, since
    // existing consumers (and createInvitation) still read it, not issues.
    expect(row.errors.some((e) => e.field === "payment_method")).toBe(true);
  });

  it("does not flag a row with no amount paid at all", async () => {
    const { bulkImportValidationService } = await import(
      "@/lib/services/bulk-import-validation-service"
    );

    const result = await bulkImportValidationService.validateRows(
      [
        {
          name: "Ravi",
          phone: "9876500004",
          email: "ravi.free@example.com",
          room_no: "101",
          joining_date: "2026-09-01",
        } as any,
      ],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );

    const row = [...result.validRows, ...result.invalidRows][0];
    expect(row.issues.map((i) => i.code)).not.toContain("PAYMENT_METHOD_MISSING");
  });
});
