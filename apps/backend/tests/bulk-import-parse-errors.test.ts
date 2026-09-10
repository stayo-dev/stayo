import { vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    profile: { findMany: vi.fn() },
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

import { beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { bulkImportValidationService } from "@/lib/services/bulk-import-validation-service";

function workbookBuffer(rows: Record<string, unknown>[]): Buffer {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Tenants");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function tenantRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    Name: `Tenant ${i + 1}`,
    Phone: `98765${String(i).padStart(5, "0")}`,
    Email: `tenant${i + 1}@example.com`,
    Room: "101",
  }));
}

describe("parseFile — too many rows", () => {
  it("tells the owner the row count, not that the file is corrupt", async () => {
    const buffer = workbookBuffer(tenantRows(151));

    await expect(
      bulkImportValidationService.parseFile(buffer, "big.xlsx")
    ).rejects.toThrow(/151 rows/);
  });

  it("does not claim a valid file failed to parse", async () => {
    const buffer = workbookBuffer(tenantRows(151));

    await expect(
      bulkImportValidationService.parseFile(buffer, "big.xlsx")
    ).rejects.not.toThrow(/valid Excel or CSV/);
  });

  it("accepts a file at exactly the limit", async () => {
    const buffer = workbookBuffer(tenantRows(150));

    const rows = await bulkImportValidationService.parseFile(buffer, "ok.xlsx");
    expect(rows).toHaveLength(150);
  });
});

describe("joining dates that cannot be trusted", () => {
  const HOSTEL_ID = "11111111-1111-1111-1111-111111111111";
  const OWNER_ID = "22222222-2222-2222-2222-222222222222";

  beforeEach(() => {
    mockPrisma.profile.findMany.mockResolvedValue([]);
    mockPrisma.tenant_invitations.findMany.mockResolvedValue([]);
    mockPrisma.rooms.findMany.mockResolvedValue([
      {
        id: "33333333-3333-3333-3333-333333333333",
        room_no: "101",
        is_active: true,
        capacity: 5,
        base_rent: 8500,
        _count: { room_allocations: 0, tenant_invitation_reservations: 0 },
      },
    ]);
  });

  async function validateJoiningDate(joining_date: string) {
    const result = await bulkImportValidationService.validateRows(
      [
        {
          name: "Ravi",
          phone: "9876500001",
          email: "ravi@example.com",
          room_no: "101",
          joining_date,
        } as any,
      ],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );
    return [...result.validRows, ...result.invalidRows][0];
  }

  it.each(["May", "next monday", "soon", "12", "abcd"])(
    "rejects %s rather than inventing a date",
    async (value) => {
      const row = await validateJoiningDate(value);
      expect(row.errors.some((e) => e.field === "joining_date")).toBe(true);
    }
  );

  it.each(["2026-01-05", "05/01/2026", "05-01-2026"])(
    "still accepts %s",
    async (value) => {
      const row = await validateJoiningDate(value);
      expect(row.errors.filter((e) => e.field === "joining_date")).toEqual([]);
    }
  );
});
