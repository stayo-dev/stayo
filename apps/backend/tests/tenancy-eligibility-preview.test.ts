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

  it("reports no account for a phone with neither a profile nor a tenancy", async () => {
    prismaMock.profile.findFirst.mockResolvedValue(null);
    prismaMock.tenants.findMany.mockResolvedValue([]);

    await expect(
      tenancyEligibilityService.previewEligibilityByContact({ phone: "9876543210" }, "owner-a")
    ).resolves.toEqual({ hasAccount: false, eligibility: { eligible: true } });
  });

  it("still looks for tenancies when no profile matches — the orphan case", async () => {
    // REGRESSION: this previously short-circuited on "no profile" and never
    // queried tenancies at all. Adoption used to leave `profile_id` null, so an
    // owner-managed tenancy had no profile to be found by — and was therefore
    // invisible here. In production that let a second invite through two
    // minutes after an adoption, leaving one phone with three tenancies in one
    // hostel. The lookup by phone must happen whether or not a profile exists.
    prismaMock.profile.findFirst.mockResolvedValue(null);
    prismaMock.tenants.findMany.mockResolvedValue([]);

    await tenancyEligibilityService.previewEligibilityByContact({ phone: "9876543210" }, "owner-a");

    expect(prismaMock.tenants.findMany).toHaveBeenCalled();
    const where = prismaMock.tenants.findMany.mock.calls[0][0].where;
    expect(where.phone_1).toBe("+919876543210");
    expect(where.status).toEqual({ in: ["ACTIVE", "INVITED"] });
  });

  it("refuses a phone whose live tenancy has no profile attached", async () => {
    prismaMock.profile.findFirst.mockResolvedValue(null);
    prismaMock.tenants.findMany.mockResolvedValue([tenancyRow({ owner_id: "owner-a" })]);

    const result = await tenancyEligibilityService.previewEligibilityByContact(
      { phone: "9876543210" },
      "owner-a"
    );

    expect(result.hasAccount).toBe(false);
    expect(result.eligibility.eligible).toBe(false);
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
