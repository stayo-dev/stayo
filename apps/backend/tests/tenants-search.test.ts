import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { tenantService } from "@/src/services/tenants/tenant-service";
import { createTestOwner, createTestHostel } from "./factories/owner-factory";
import { createTestTenant, allocateTestRoom } from "./factories/tenant-factory";
import { createTestRoom } from "./factories/room-factory";

describe("Tenant Search Logic Tests", () => {
  let owner: any;
  let hostel: any;
  let tenant1: any;
  let tenant2: any;
  let room1: any;
  let room2: any;

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "test"."profiles" CASCADE`;

    owner = await createTestOwner();
    hostel = await createTestHostel(owner.id);

    room1 = await createTestRoom(hostel.id, { room_no: "Room-101" });
    room2 = await createTestRoom(hostel.id, { room_no: "Room-202" });

    // Tenant 1 details
    tenant1 = await createTestTenant(owner.id, hostel.id, {
      name: "Alice Smith",
      email: "alice@example.com",
      phone: "9876543210"
    });
    await allocateTestRoom(tenant1.id, room1.id, { hostel_id: hostel.id });

    // Tenant 2 details
    tenant2 = await createTestTenant(owner.id, hostel.id, {
      name: "Bob Jones",
      email: "bob@example.com",
      phone: "1234567890"
    });
    await allocateTestRoom(tenant2.id, room2.id, { hostel_id: hostel.id });
  });

  it("can search by name", async () => {
    const result = await tenantService.getAllTenants({
      hostelId: hostel.id,
      ownerId: owner.id,
      search: "Alice"
    });
    expect(result.tenants.length).toBe(1);
    expect(result.tenants[0].id).toBe(tenant1.id);
  });

  it("can search by phone number", async () => {
    const result = await tenantService.getAllTenants({
      hostelId: hostel.id,
      ownerId: owner.id,
      search: "12345"
    });
    expect(result.tenants.length).toBe(1);
    expect(result.tenants[0].id).toBe(tenant2.id);
  });

  it("can search by room number", async () => {
    const result = await tenantService.getAllTenants({
      hostelId: hostel.id,
      ownerId: owner.id,
      search: "202"
    });
    expect(result.tenants.length).toBe(1);
    expect(result.tenants[0].id).toBe(tenant2.id);
  });
});
