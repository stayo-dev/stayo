import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createTestOwner, createTestHostel } from "./factories/owner-factory";
import { createTestTenant, allocateTestRoom } from "./factories/tenant-factory";
import { createTestRoom } from "./factories/room-factory";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/tenants/export/route";

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
  apiError: (message: string, code?: string, status?: number) => {
    return new Response(JSON.stringify({ success: false, error: { message, code } }), {
      status: status || 500,
      headers: { "Content-Type": "application/json" },
    });
  },
}));

describe("Tenant Master Export API Endpoint Tests", () => {
  let owner: any;
  let hostel: any;
  let tenant: any;
  let room: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.$executeRaw`TRUNCATE TABLE "test"."profiles" CASCADE`;

    owner = await createTestOwner();
    hostel = await createTestHostel(owner.id);
    room = await createTestRoom(hostel.id);
    tenant = await createTestTenant(owner.id, hostel.id);
    await allocateTestRoom(tenant.id, room.id, { hostel_id: hostel.id });
  });

  it("returns 401 if unauthorized", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/tenants/export?hostelId=" + hostel.id);
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 if hostelId is missing", async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: owner.id,
      role: "OWNER",
      email: owner.email,
    } as any);
    const req = new NextRequest("http://localhost/api/tenants/export");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 200 and generated CSV for authorized OWNER", async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: owner.id,
      owner_id: owner.id,
      role: "OWNER",
      email: owner.email,
    } as any);

    const req = new NextRequest(`http://localhost/api/tenants/export?hostelId=${hostel.id}`);
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");

    const text = await res.text();
    const lines = text.trim().split("\n");
    expect(lines.length).toBeGreaterThan(1);
    
    // Header check
    expect(lines[0]).toContain("Tenant Name");
    expect(lines[0]).toContain("Tenant Phone");
    expect(lines[0]).toContain("Hostel");
    expect(lines[0]).toContain("Floor");
    expect(lines[0]).toContain("Room");
    expect(lines[0]).toContain("Bed");
    
    // Data check - matches tenant name
    const profile = await prisma.profile.findUnique({ where: { id: tenant.profile_id } });
    expect(profile).not.toBeNull();
    expect(lines[1]).toContain(profile!.name);
  });
});
