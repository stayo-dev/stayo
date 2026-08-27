import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  tenants: { findMany: vi.fn() },
  profile: { findFirst: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { tenancyEligibilityService } from "@/src/services/tenants/tenancy-eligibility-service";

/** A row shaped the way `loadTenancies`'s Prisma select returns it. */
function tenancyRow(overrides: Record<string, any> = {}) {
  return {
    id: "tenancy-1",
    status: "ACTIVE",
    owner_id: "owner-a",
    activation_completed_at: new Date("2026-01-01"),
    hostels: { name: "Sunrise Residency" },
    room_allocations: [{ room: { room_no: "204" } }],
    move_out_requests: [],
    ...overrides,
  };
}

describe("TenancyEligibilityService.previewEligibilityByContact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports no account for an unknown phone, without touching tenancies", async () => {
    prismaMock.profile.findFirst.mockResolvedValue(null);

    await expect(
      tenancyEligibilityService.previewEligibilityByContact({ phone: "9876543210" }, "owner-a")
    ).resolves.toEqual({ hasAccount: false, eligibility: { eligible: true } });
    expect(prismaMock.tenants.findMany).not.toHaveBeenCalled();
  });

  it("reports an existing, currently eligible account", async () => {
    prismaMock.profile.findFirst.mockResolvedValue({ id: "profile-1" });
    prismaMock.tenants.findMany.mockResolvedValue([]);

    await expect(
      tenancyEligibilityService.previewEligibilityByContact({ phone: "9876543210" }, "owner-a")
    ).resolves.toEqual({ hasAccount: true, eligibility: { eligible: true } });
  });

  it("names the hostel only when the live tenancy belongs to the asking owner", async () => {
    prismaMock.profile.findFirst.mockResolvedValue({ id: "profile-1" });
    prismaMock.tenants.findMany.mockResolvedValue([tenancyRow({ owner_id: "owner-a" })]);

    const result = await tenancyEligibilityService.previewEligibilityByContact(
      { phone: "9876543210" },
      "owner-a"
    );

    expect(result.hasAccount).toBe(true);
    expect(result.eligibility).toMatchObject({
      eligible: false,
      code: "TENANT_HAS_ACTIVE_TENANCY",
      disclosure: {
        scope: "OWN",
        hostelName: "Sunrise Residency",
        roomNumber: "204",
        tenantId: "tenancy-1",
      },
    });
  });

  it("blanks the hostel when the live tenancy belongs to a different owner", async () => {
    prismaMock.profile.findFirst.mockResolvedValue({ id: "profile-1" });
    prismaMock.tenants.findMany.mockResolvedValue([tenancyRow({ owner_id: "owner-a" })]);

    const result = await tenancyEligibilityService.previewEligibilityByContact(
      { phone: "9876543210" },
      "owner-b"
    );

    expect(result.hasAccount).toBe(true);
    expect(result.eligibility).toMatchObject({
      eligible: false,
      code: "TENANT_HAS_ACTIVE_TENANCY",
      disclosure: { scope: "OTHER", hostelName: null, roomNumber: null, tenantId: null },
    });
  });

  it("blanks the hostel for an unsettled previous tenancy at a different owner too", async () => {
    prismaMock.profile.findFirst.mockResolvedValue({ id: "profile-1" });
    prismaMock.tenants.findMany.mockResolvedValue([
      tenancyRow({ status: "FORMER_TENANT", owner_id: "owner-a", move_out_requests: [] }),
    ]);

    const result = await tenancyEligibilityService.previewEligibilityByContact(
      { phone: "9876543210" },
      "owner-b"
    );

    expect(result.hasAccount).toBe(true);
    expect(result.eligibility).toMatchObject({
      eligible: false,
      code: "PREVIOUS_TENANCY_NOT_SETTLED",
      disclosure: { scope: "OTHER", hostelName: null, roomNumber: null, tenantId: null },
    });
  });

  it("never mutates anything — no tenants/profile write calls exist to make", async () => {
    prismaMock.profile.findFirst.mockResolvedValue({ id: "profile-1" });
    prismaMock.tenants.findMany.mockResolvedValue([]);

    await tenancyEligibilityService.previewEligibilityByContact({ phone: "9876543210" }, "owner-a");

    expect(Object.keys(prismaMock.tenants)).toEqual(["findMany"]);
    expect(Object.keys(prismaMock.profile)).toEqual(["findFirst"]);
  });
});
