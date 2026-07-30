import { describe, expect, it, vi, beforeEach } from "vitest";
import { assertGuardianPhoneNotTenant } from "../lib/utils/phone-utils";
import { prisma } from "../lib/db";

vi.mock("../lib/db", () => {
  const mockPrisma = {
    tenants: {
      findFirst: vi.fn(),
    },
  };
  return { prisma: mockPrisma };
});

describe("assertGuardianPhoneNotTenant validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return early if phone number is empty or invalid", async () => {
    await expect(assertGuardianPhoneNotTenant(null)).resolves.toBeUndefined();
    await expect(assertGuardianPhoneNotTenant("")).resolves.toBeUndefined();
    await expect(assertGuardianPhoneNotTenant("invalid-phone")).resolves.toBeUndefined();
    expect(prisma.tenants.findFirst).not.toHaveBeenCalled();
  });

  it("should throw validation error if guardian phone matches an existing tenant primary phone", async () => {
    vi.mocked(prisma.tenants.findFirst).mockResolvedValueOnce({
      id: "existing-tenant-id",
      profiles: {
        name: "Test Tenant"
      }
    } as any);

    await expect(assertGuardianPhoneNotTenant("8008046952")).rejects.toThrow(
      "VALIDATION_ERROR: Guardian phone number cannot be the same as a tenant's phone number (Test Tenant)"
    );

    expect(prisma.tenants.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { phone_1: "+918008046952" },
          { profiles: { phone: "+918008046952" } }
        ]
      },
      select: {
        id: true,
        profiles: {
          select: {
            name: true
          }
        }
      }
    });
  });

  it("should succeed if guardian phone does not match any tenant in database", async () => {
    vi.mocked(prisma.tenants.findFirst).mockResolvedValueOnce(null);

    await expect(assertGuardianPhoneNotTenant("9999999999")).resolves.toBeUndefined();

    expect(prisma.tenants.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { phone_1: "+919999999999" },
          { profiles: { phone: "+919999999999" } }
        ]
      },
      select: {
        id: true,
        profiles: {
          select: {
            name: true
          }
        }
      }
    });
  });

  it("should throw validation error if guardian phone matches tenant's own phone when tenantId is provided", async () => {
    vi.mocked(prisma.tenants.findFirst).mockResolvedValueOnce({
      id: "my-tenant-id",
      profiles: {
        name: "My Self"
      }
    } as any);

    await expect(assertGuardianPhoneNotTenant("8008046952", "my-tenant-id")).rejects.toThrow(
      "VALIDATION_ERROR: Guardian phone number cannot be the same as a tenant's phone number (My Self)"
    );

    expect(prisma.tenants.findFirst).toHaveBeenCalledWith({
      where: {
        id: "my-tenant-id",
        OR: [
          { phone_1: "+918008046952" },
          { profiles: { phone: "+918008046952" } }
        ]
      },
      select: {
        id: true,
        profiles: {
          select: {
            name: true
          }
        }
      }
    });
  });

  it("should succeed if guardian phone does not match tenant's own phone numbers even if another tenant has it", async () => {
    vi.mocked(prisma.tenants.findFirst).mockResolvedValueOnce(null);

    await expect(assertGuardianPhoneNotTenant("8008046952", "my-tenant-id")).resolves.toBeUndefined();

    expect(prisma.tenants.findFirst).toHaveBeenCalledWith({
      where: {
        id: "my-tenant-id",
        OR: [
          { phone_1: "+918008046952" },
          { profiles: { phone: "+918008046952" } }
        ]
      },
      select: {
        id: true,
        profiles: {
          select: {
            name: true
          }
        }
      }
    });
  });
});
