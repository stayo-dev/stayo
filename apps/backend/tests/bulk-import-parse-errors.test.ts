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

import { describe, expect, it } from "vitest";
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
