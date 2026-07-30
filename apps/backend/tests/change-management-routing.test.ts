import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { tenantService } from "@/src/services/tenants/tenant-service";
import { createTestOwner, createTestHostel } from "./factories/owner-factory";
import { createTestTenant } from "./factories/tenant-factory";

describe("Change Management Routing & Classification Tests", () => {
  let owner: any;
  let hostel: any;
  let activeTenant: any;
  let invitedTenant: any;

  beforeEach(async () => {
    // Clean tables before each test
    await prisma.$executeRaw`TRUNCATE TABLE "test"."change_request_events" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "test"."change_requests" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "test"."profiles" CASCADE`;

    owner = await createTestOwner();
    hostel = await createTestHostel(owner.id);

    // 1. Create an ACTIVE tenant (already has "activated" and outside correction window if we simulate payments or status)
    activeTenant = await createTestTenant(owner.id, hostel.id, {
      name: "John Active",
      email: "active@example.com",
      phone: "9876543210",
      status: "ACTIVE",
    });

    // 2. Create an INVITED tenant (pre-activation, correction window candidate)
    invitedTenant = await createTestTenant(owner.id, hostel.id, {
      name: "Jenny Invited",
      email: "invited@example.com",
      phone: "1234567890",
      status: "INVITED",
    });
  });

  it("applies Category A updates immediately and logs applied CR", async () => {
    // Category A field: college_name
    const result = await tenantService.updateTenant(
      activeTenant.id,
      { college_name: "Stanford University", reason: "Correction" },
      owner.id
    );

    expect(result.applied).toBe(true);
    expect(result.tenant.college_name).toBe("Stanford University");

    // Verify DB update
    const dbTenant = await prisma.tenants.findUnique({
      where: { id: activeTenant.id },
    });
    expect(dbTenant?.college_name).toBe("Stanford University");

    // Verify change_requests record
    const cr = await prisma.change_requests.findFirst({
      where: { tenant_id: activeTenant.id },
      include: { events: true },
    });
    expect(cr).not.toBeNull();
    expect(cr?.status).toBe("APPLIED");
    expect(cr?.change_category).toBe("A");
    expect(cr?.diff).toEqual({ college_name: "Stanford University" });
    expect(cr?.events.length).toBeGreaterThan(0);
    expect(cr?.events[0].action).toBe("applied");
  });

  it("routes Category B updates to pending CR", async () => {
    // Category B field: name
    const result = await tenantService.updateTenant(
      activeTenant.id,
      { name: "John NewName", reason: "Owner request" },
      owner.id
    );

    expect(result.applied).toBe(false);
    expect(result.changeRequest).toBeDefined();
    expect(result.changeRequest.status).toBe("PENDING");
    expect(result.changeRequest.changeCategory).toBe("B");

    // Verify DB remains UNCHANGED
    const dbTenant = await prisma.tenants.findUnique({
      where: { id: activeTenant.id },
      include: { profiles: true },
    });
    expect(dbTenant?.profiles?.name).toBe("John Active"); // unchanged

    // Verify change_requests record in DB
    const cr = await prisma.change_requests.findUnique({
      where: { id: result.changeRequest.id },
    });
    expect(cr).not.toBeNull();
    expect(cr?.status).toBe("PENDING");
    expect(cr?.diff).toEqual({ name: "John NewName" });
  });

  it("routes Category C updates to pending CR with L3 approval", async () => {
    // Category C field: monthly_rent
    const result = await tenantService.updateTenant(
      activeTenant.id,
      { monthly_rent: 9500, reason: "Annual Rent Adjustment" },
      owner.id
    );

    expect(result.applied).toBe(false);
    expect(result.changeRequest).toBeDefined();
    expect(result.changeRequest.status).toBe("PENDING");
    expect(result.changeRequest.changeCategory).toBe("C");
    expect(result.changeRequest.approvalLevel).toBe("L3");

    // Verify DB remains UNCHANGED
    const dbTenant = await prisma.tenants.findUnique({
      where: { id: activeTenant.id },
    });
    expect(Number(dbTenant?.monthly_rent)).not.toBe(9500);
  });

  it("processes mixed updates by applying Cat A immediately and routing Cat B/C to pending CR", async () => {
    // Cat A (college_name) + Cat B (name)
    const result = await tenantService.updateTenant(
      activeTenant.id,
      {
        college_name: "MIT",
        name: "John MixedName",
        reason: "Double Update",
      },
      owner.id
    );

    expect(result.applied).toBe(false);
    expect(result.changeRequest).toBeDefined();
    expect(result.changeRequest.changeCategory).toBe("B");

    // Verify Cat A applied to DB
    const dbTenant = await prisma.tenants.findUnique({
      where: { id: activeTenant.id },
      include: { profiles: true },
    });
    expect(dbTenant?.college_name).toBe("MIT");
    // Verify Cat B is NOT applied to DB
    expect(dbTenant?.profiles?.name).toBe("John Active");

    // Verify the Cat A immediate apply was logged as APPLIED
    const appliedCr = await prisma.change_requests.findFirst({
      where: { tenant_id: activeTenant.id, status: "APPLIED" },
    });
    expect(appliedCr).not.toBeNull();
    expect(appliedCr?.diff).toEqual({ college_name: "MIT" });

    // Verify the Cat B pending request is saved in DB
    const pendingCr = await prisma.change_requests.findFirst({
      where: { tenant_id: activeTenant.id, status: "PENDING" },
    });
    expect(pendingCr).not.toBeNull();
    expect(pendingCr?.diff).toEqual({ name: "John MixedName" });
  });

  it("allows immediate updates of all categories within the Correction Window (INVITED status)", async () => {
    // Invited tenant with no payments: correction window active
    // Let's modify a Cat C field (monthly_rent) + Cat B field (name)
    const result = await tenantService.updateTenant(
      invitedTenant.id,
      {
        monthly_rent: 12000,
        name: "Jenny Corrected",
        reason: "Administrative correction",
      },
      owner.id
    );

    expect(result.applied).toBe(true);

    // Verify DB updated immediately
    const dbTenant = await prisma.tenants.findUnique({
      where: { id: invitedTenant.id },
      include: { profiles: true },
    });
    expect(Number(dbTenant?.monthly_rent)).toBe(12000);
    expect(dbTenant?.profiles?.name).toBe("Jenny Corrected");

    // Verify audit request exists with status APPLIED
    const cr = await prisma.change_requests.findFirst({
      where: { tenant_id: invitedTenant.id },
    });
    expect(cr).not.toBeNull();
    expect(cr?.status).toBe("APPLIED");
    expect(cr?.diff).toEqual({
      monthly_rent: 12000,
      name: "Jenny Corrected",
    });
  });

  it("throws validation error for unclassified fields", async () => {
    await expect(
      tenantService.updateTenant(
        activeTenant.id,
        {
          college_name: "Harvard",
          some_unclassified_random_field: "value",
          reason: "Should fail",
        },
        owner.id
      )
    ).rejects.toThrow("VALIDATION: Unclassified fields are not allowed");
  });
});
