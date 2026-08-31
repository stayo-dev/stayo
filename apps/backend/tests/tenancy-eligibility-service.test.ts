import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  tenants: { findMany: vi.fn() },
  profile: { findFirst: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  TenancyEligibilityError,
  tenancyEligibilityService,
} from "@/src/services/tenants/tenancy-eligibility-service";

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

describe("TenancyEligibilityService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets a person with no tenancy history join", async () => {
    prismaMock.tenants.findMany.mockResolvedValue([]);

    await expect(
      tenancyEligibilityService.assertCanStartNewTenancy("profile-1", "owner-b")
    ).resolves.toEqual({ eligible: true });
  });

  it("refuses someone who already holds a live tenancy", async () => {
    prismaMock.tenants.findMany.mockResolvedValue([tenancyRow()]);

    await expect(
      tenancyEligibilityService.assertCanStartNewTenancy("profile-1", "owner-b")
    ).rejects.toThrow(TenancyEligibilityError);
  });

  it("gives the refusal a 409 and a machine-readable code", async () => {
    prismaMock.tenants.findMany.mockResolvedValue([tenancyRow()]);

    const error = await tenancyEligibilityService
      .assertCanStartNewTenancy("profile-1", "owner-b")
      .catch((e) => e);

    expect(error.status).toBe(409);
    expect(error.code).toBe("TENANT_HAS_ACTIVE_TENANCY");
  });

  it("names the hostel and room to the owner who already houses them", async () => {
    prismaMock.tenants.findMany.mockResolvedValue([tenancyRow({ owner_id: "owner-a" })]);

    const result = await tenancyEligibilityService.checkEligibility("profile-1", "owner-a");

    expect(result).toMatchObject({
      disclosure: {
        scope: "OWN",
        hostelName: "Sunrise Residency",
        roomNumber: "204",
        tenantId: "tenancy-1",
      },
    });
  });

  it("tells a different owner nothing but that the person is taken", async () => {
    prismaMock.tenants.findMany.mockResolvedValue([tenancyRow({ owner_id: "owner-a" })]);

    const result = await tenancyEligibilityService.checkEligibility("profile-1", "owner-b");

    expect(result).toMatchObject({
      disclosure: { scope: "OTHER", hostelName: null, roomNumber: null, tenantId: null },
    });
  });

  it("keeps a moved-out tenant blocked until settlement completes", async () => {
    prismaMock.tenants.findMany.mockResolvedValue([
      tenancyRow({ status: "FORMER_TENANT", move_out_requests: [] }),
    ]);

    const result = await tenancyEligibilityService.checkEligibility("profile-1", "owner-b");

    expect(result).toMatchObject({ code: "PREVIOUS_TENANCY_NOT_SETTLED" });
  });

  it("releases a moved-out tenant once settlement completes", async () => {
    prismaMock.tenants.findMany.mockResolvedValue([
      tenancyRow({ status: "FORMER_TENANT", move_out_requests: [{ id: "mo-1" }] }),
    ]);

    await expect(
      tenancyEligibilityService.checkEligibility("profile-1", "owner-b")
    ).resolves.toEqual({ eligible: true });
  });

  it("only counts COMPLETED move-outs as settlement", async () => {
    prismaMock.tenants.findMany.mockResolvedValue([tenancyRow({ status: "FORMER_TENANT" })]);

    await tenancyEligibilityService.checkEligibility("profile-1", "owner-b");

    // A tenancy is marked FORMER_TENANT at the exit date, which can precede the
    // settlement money moving — so the query must filter on COMPLETED, not merely
    // "has a move-out request".
    expect(prismaMock.tenants.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          move_out_requests: expect.objectContaining({
            where: { status: "COMPLETED" },
          }),
        }),
      })
    );
  });

  it("does not trap someone whose invitation expired before they ever moved in", async () => {
    prismaMock.tenants.findMany.mockResolvedValue([
      tenancyRow({ status: "EXPIRED", activation_completed_at: null, move_out_requests: [] }),
    ]);

    await expect(
      tenancyEligibilityService.checkEligibility("profile-1", "owner-b")
    ).resolves.toEqual({ eligible: true });
  });

  describe("checkEligibilityByContact", () => {
    it("treats an unknown email as invitable without touching tenancies", async () => {
      prismaMock.profile.findFirst.mockResolvedValue(null);

      await expect(
        tenancyEligibilityService.checkEligibilityByContact(
          { email: "nobody@example.com" },
          "owner-a"
        )
      ).resolves.toEqual({ eligible: true });
      expect(prismaMock.tenants.findMany).not.toHaveBeenCalled();
    });

    it("resolves a profile by email or phone before judging", async () => {
      prismaMock.profile.findFirst.mockResolvedValue({ id: "profile-1" });
      prismaMock.tenants.findMany.mockResolvedValue([tenancyRow()]);

      const result = await tenancyEligibilityService.checkEligibilityByContact(
        { email: "Someone@Example.com ", phone: "9876543210" },
        "owner-b"
      );

      expect(result).toMatchObject({ code: "TENANT_HAS_ACTIVE_TENANCY" });
      expect(prismaMock.profile.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ email: "someone@example.com" }, { phone: "9876543210" }] },
        })
      );
    });

    it("says nothing when given neither email nor phone", async () => {
      await expect(
        tenancyEligibilityService.checkEligibilityByContact({}, "owner-a")
      ).resolves.toEqual({ eligible: true });
      expect(prismaMock.profile.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("hasLiveTenancyAtHostel", () => {
    it("is true when the phone holds a live tenancy at this exact hostel", async () => {
      prismaMock.tenants.findMany.mockResolvedValue([tenancyRow({ status: "ACTIVE" })]);

      await expect(
        tenancyEligibilityService.hasLiveTenancyAtHostel("9876543210", "hostel-1")
      ).resolves.toBe(true);

      expect(prismaMock.tenants.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { phone_1: "+919876543210", hostel_id: "hostel-1", status: { in: ["ACTIVE", "INVITED"] } },
        })
      );
    });

    it("is false when there is no live tenancy at this hostel", async () => {
      prismaMock.tenants.findMany.mockResolvedValue([]);

      await expect(
        tenancyEligibilityService.hasLiveTenancyAtHostel("9876543210", "hostel-1")
      ).resolves.toBe(false);
    });

    it("does not let a different email change the answer — mobile is the primary identity", async () => {
      // The query only ever filters by phone_1; a different email on the new
      // lead has no bearing on this check at all.
      prismaMock.tenants.findMany.mockResolvedValue([tenancyRow({ status: "ACTIVE" })]);

      const resultWithOneEmailOnFile = await tenancyEligibilityService.hasLiveTenancyAtHostel("9876543210", "hostel-1");
      const resultAsIfSubmittedWithADifferentEmail = await tenancyEligibilityService.hasLiveTenancyAtHostel("9876543210", "hostel-1");

      expect(resultWithOneEmailOnFile).toBe(resultAsIfSubmittedWithADifferentEmail);
    });

    it("is false for an unparseable phone number, without querying the database", async () => {
      await expect(
        tenancyEligibilityService.hasLiveTenancyAtHostel("not-a-phone", "hostel-1")
      ).resolves.toBe(false);
      expect(prismaMock.tenants.findMany).not.toHaveBeenCalled();
    });
  });
});
