import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/payments/quick-collect/search/route";
import { POST } from "@/app/api/payments/record-offline/route";
import { prisma } from "@/lib/db";
import { createTestOwner, createTestHostel } from "./factories/owner-factory";
import { createTestTenant, allocateTestRoom } from "./factories/tenant-factory";
import { createTestRoom } from "./factories/room-factory";
import { authService } from "@/lib/services/auth-service";
import { verifyIdentityToken } from "@/lib/auth-edge";

vi.mock("@/lib/services/auth-service", () => {
  return {
    authService: {
      getCurrentUser: vi.fn(),
    },
  };
});

vi.mock("@/lib/auth-edge", () => {
  return {
    verifyIdentityToken: vi.fn(),
  };
});

describe("Quick Collect API Endpoints", () => {
  let owner: any;
  let hostelA: any;
  let hostelB: any;
  let roomA: any;
  let roomB: any;
  let tenantA: any;
  let tenantB: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.$executeRaw`TRUNCATE TABLE "test"."profiles" CASCADE`;

    owner = await createTestOwner();
    hostelA = await createTestHostel(owner.id, {
      preferences_config: {
        billing: {
          partial_payments: {
            enabled: true,
          },
        },
      },
    });
    hostelB = await createTestHostel(owner.id);

    roomA = await createTestRoom(hostelA.id, { room_no: "A-101" });
    roomB = await createTestRoom(hostelB.id, { room_no: "B-202" });

    tenantA = await createTestTenant(owner.id, hostelA.id, {
      name: "Alice Stark",
      email: "alice.stark@example.com",
      phone: "9876543210",
    });
    await allocateTestRoom(tenantA.id, roomA.id, { hostel_id: hostelA.id });

    tenantB = await createTestTenant(owner.id, hostelB.id, {
      name: "Bob Banner",
      email: "bob.banner@example.com",
      phone: "1234567890",
    });
    await allocateTestRoom(tenantB.id, roomB.id, { hostel_id: hostelB.id });
  });

  describe("GET /api/payments/quick-collect/search", () => {
    it("should return 401 if user is unauthorized", async () => {
      vi.mocked(authService.getCurrentUser).mockResolvedValue(null);

      const req = new NextRequest("http://localhost/api/payments/quick-collect/search?search=Alice");
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it("should search active tenants system-wide (across multiple hostels) for the owner", async () => {
      vi.mocked(authService.getCurrentUser).mockResolvedValue({
        id: owner.id,
        role: "OWNER",
        email: owner.email,
      } as any);

      // Search matching both
      const req = new NextRequest("http://localhost/api/payments/quick-collect/search?search=a");
      const res = await GET(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.length).toBe(2);

      const names = json.data.map((t: any) => t.name);
      expect(names).toContain("Alice Stark");
      expect(names).toContain("Bob Banner");

      // Verify cross-hostel hostel names
      const hostels = json.data.map((t: any) => t.hostel_name);
      expect(hostels).toContain(hostelA.name);
      expect(hostels).toContain(hostelB.name);
    });

    it("should correctly search and filter by room number", async () => {
      vi.mocked(authService.getCurrentUser).mockResolvedValue({
        id: owner.id,
        role: "OWNER",
        email: owner.email,
      } as any);

      const req = new NextRequest("http://localhost/api/payments/quick-collect/search?search=B-202");
      const res = await GET(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.length).toBe(1);
      expect(json.data[0].name).toBe("Bob Banner");
      expect(json.data[0].room_no).toBe("B-202");
    });
  });

  describe("POST /api/payments/record-offline", () => {
    it("should record an offline payment for rent", async () => {
      vi.mocked(authService.getCurrentUser).mockResolvedValue({
        id: owner.id,
        role: "OWNER",
        email: owner.email,
      } as any);

      vi.mocked(verifyIdentityToken).mockResolvedValue({
        userId: owner.id,
        jti: "test-jti-token",
        action: "record_offline_payment",
      });

      // Insert identity token record into DB
      await prisma.identity_tokens.create({
        data: {
          jti: "test-jti-token",
          user_id: owner.id,
          purpose: "OFFLINE_PAYMENT",
          action: "record_offline_payment",
          expires_at: new Date(Date.now() + 60000),
          used: false,
        },
      });

      // Create a pending rent obligation for tenantA
      const obligation = await prisma.rent_obligations.create({
        data: {
          tenant_id: tenantA.id,
          hostel_id: hostelA.id,
          owner_id: owner.id,
          rent_month: new Date(),
          amount: 5000,
          total_amount: 5000,
          obligation_type: "RENT",
          status: "PENDING",
          due_date: new Date(),
        },
      });

      const req = new NextRequest("http://localhost/api/payments/record-offline", {
        method: "POST",
        body: JSON.stringify({
          identity_token: "mock-valid-token",
          tenant_id: tenantA.id,
          hostel_id: hostelA.id,
          payment_type: "RENT",
          payment_method: "CASH",
          amount_paid: 4000,
          reference_number: "TXN12345",
          payment_date: new Date().toISOString(),
        }),
      });

      const res = await POST(req);
      const json = await res.json();
      if (res.status !== 200) {
        console.error("RENT PAYMENT RECORD ERROR:", json);
      }

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.allocations).toBeDefined();
      expect(json.allocations.length).toBe(1);
      expect(Number(json.allocations[0].allocated)).toBe(4000);

      // Verify that the obligation was updated (partially paid)
      const updatedObligation = await prisma.rent_obligations.findUnique({
        where: { id: obligation.id },
      });
      expect(updatedObligation?.status).toBe("PARTIAL");
    });

    it("should record security deposit offline payments", async () => {
      vi.mocked(authService.getCurrentUser).mockResolvedValue({
        id: owner.id,
        role: "OWNER",
        email: owner.email,
      } as any);

      vi.mocked(verifyIdentityToken).mockResolvedValue({
        userId: owner.id,
        jti: "test-jti-token-2",
        action: "record_offline_payment",
      });

      // Insert identity token record into DB
      await prisma.identity_tokens.create({
        data: {
          jti: "test-jti-token-2",
          user_id: owner.id,
          purpose: "OFFLINE_PAYMENT",
          action: "record_offline_payment",
          expires_at: new Date(Date.now() + 60000),
          used: false,
        },
      });

      const req = new NextRequest("http://localhost/api/payments/record-offline", {
        method: "POST",
        body: JSON.stringify({
          identity_token: "mock-valid-token-2",
          tenant_id: tenantA.id,
          hostel_id: hostelA.id,
          payment_type: "SECURITY_DEPOSIT",
          payment_method: "UPI",
          amount_paid: 10000,
          payment_date: new Date().toISOString(),
        }),
      });

      const res = await POST(req);
      const json = await res.json();
      if (res.status !== 200) {
        console.error("SD PAYMENT RECORD ERROR:", json);
      }

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.future_credit).toBe(10000);
    });
  });
});
