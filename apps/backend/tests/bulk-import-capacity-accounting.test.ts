import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => {
  const prisma: any = {
    profile: { findMany: vi.fn() },
    tenant_invitations: { findMany: vi.fn() },
    rooms: { findMany: vi.fn() },
    // Unused today. Task 10 of this plan adds prisma.hostels.findUnique to
    // validateRows; this is one of three pure-test files whose mocks need
    // the stub in place ahead of that change.
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

import { bulkImportValidationService } from "@/lib/services/bulk-import-validation-service";

const HOSTEL_ID = "11111111-1111-1111-1111-111111111111";
const OWNER_ID = "22222222-2222-2222-2222-222222222222";

function row(name: string, phone: string, email: string) {
  return {
    name,
    phone,
    email,
    room_no: "101",
    joining_date: "2026-09-01",
  } as any;
}

beforeEach(() => {
  mockPrisma.profile.findMany.mockResolvedValue([]);
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

describe("room capacity accounting", () => {
  it("does not let duplicate rows consume beds", async () => {
    // Rows 2 and 3 repeat row 1's phone, so only one of them can ever import.
    // Row 4 is a distinct person and must still fit in the 3-bed room.
    const result = await bulkImportValidationService.validateRows(
      [
        row("Ravi", "9876500001", "ravi@example.com"),
        row("Ravi Again", "9876500001", "ravi.dup@example.com"),
        row("Ravi Third", "9876500001", "ravi.dup2@example.com"),
        row("Priya", "9876500002", "priya@example.com"),
      ],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );

    const priya = [...result.validRows, ...result.invalidRows].find(
      (r) => r.data.name === "Priya"
    );
    expect(priya).toBeDefined();
    expect(priya!.errors).toEqual([]);
    expect(result.validRows.map((r) => r.data.name)).toContain("Priya");
  });

  it("still rejects a genuine over-capacity row", async () => {
    // Names here must be >= 2 characters — the brief's original fixture used
    // single letters ("A"/"B"/"C"/"D"), which trip the pre-existing "name
    // must be at least 2 characters" rule (see validateRows) unrelated to
    // capacity accounting, making all four rows fail for the wrong reason.
    const result = await bulkImportValidationService.validateRows(
      [
        row("Aa", "9876500001", "a@example.com"),
        row("Bb", "9876500002", "b@example.com"),
        row("Cc", "9876500003", "c@example.com"),
        row("Dd", "9876500004", "d@example.com"),
      ],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );

    expect(result.validRows).toHaveLength(3);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0].data.name).toBe("Dd");
    expect(result.invalidRows[0].errors[0].message).toMatch(/capacity/i);
  });

  it("a row with an invalid joining date does not consume a bed", async () => {
    // Row 1 has an unparseable joining date for the 3-bed room 101. Joining-
    // date validation runs after the capacity decision in the loop, so a row
    // that fails there must still be excluded from capacity accounting — the
    // same defect the isDuplicate/errors guard closed, reached through a
    // different field. Rows 2-4 are three genuinely valid, distinct tenants
    // and must all fit.
    const result = await bulkImportValidationService.validateRows(
      [
        { ...row("Bad Date", "9876500001", "baddate@example.com"), joining_date: "May" },
        row("Kavya", "9876500002", "kavya@example.com"),
        row("Meena", "9876500003", "meena@example.com"),
        row("Nisha", "9876500004", "nisha@example.com"),
      ],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );

    const validNames = result.validRows.map((r) => r.data.name);
    expect(validNames).toEqual(expect.arrayContaining(["Kavya", "Meena", "Nisha"]));
    expect(result.validRows).toHaveLength(3);

    for (const name of ["Kavya", "Meena", "Nisha"]) {
      const validated = [...result.validRows, ...result.invalidRows].find(
        (r) => r.data.name === name
      )!;
      expect(validated.errors.some((e) => /capacity/i.test(e.message))).toBe(false);
    }
  });
});

describe("rent_source", () => {
  it("is ROOM_CONFIG when the sheet left rent blank", async () => {
    const result = await bulkImportValidationService.validateRows(
      [row("Ravi", "9876500001", "ravi@example.com")],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );

    expect(result.validRows[0].data.rent_source).toBe("ROOM_CONFIG");
    expect(result.validRows[0].data.monthly_rent).toBe(8500);
  });

  it("is SHEET when the owner typed a rent", async () => {
    const result = await bulkImportValidationService.validateRows(
      [{ ...row("Ravi", "9876500001", "ravi@example.com"), monthly_rent: 9000 }],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );

    expect(result.validRows[0].data.rent_source).toBe("SHEET");
    expect(result.validRows[0].data.monthly_rent).toBe(9000);
  });
});
