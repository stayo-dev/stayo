import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Owner KYC verification — permission, guard and concurrency coverage.
 *
 * These routes stop one owner acting on another owner's tenant, stop a
 * rejection being recorded with no reason, and (since the KYC cleanup) stop a
 * second review from another tab flipping an already-decided document. The
 * `document_verified` flag is now derived by the shared `recomputeDocumentVerified`
 * helper rather than set inline.
 */

const { mockPrisma, mockSession, mockEventLog } = vi.hoisted(() => {
  const identificationDocument = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  };
  const tenants = { findUnique: vi.fn(), update: vi.fn() };
  const notifications = { create: vi.fn() };
  const profile = { findUnique: vi.fn() };
  const prisma: any = {
    identificationDocument,
    tenants,
    notifications,
    profile,
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };
  return {
    mockPrisma: prisma,
    mockSession: vi.fn(),
    mockEventLog: { log: vi.fn().mockResolvedValue({}) },
  };
});

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ getSession: mockSession }));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: mockEventLog }));
vi.mock("@/lib/config/domains", () => ({ backendUrl: (p: string) => `https://api.test${p}` }));

import { PATCH as verifyDocument } from "../app/api/tenants/[id]/documents/[docId]/verify/route";
import { PATCH as rejectDocument } from "../app/api/tenants/[id]/documents/[docId]/reject/route";

const OWNER_A = "owner-aaa";
const OWNER_B = "owner-bbb";
const TENANT_ID = "tenant-1";
const DOC_ID = "doc-1";

function request(body?: unknown) {
  return { json: async () => body ?? {} } as any;
}

const params = { params: { id: TENANT_ID, docId: DOC_ID } } as any;

function document(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID,
    tenant_id: TENANT_ID,
    doc_type: "AADHAAR",
    document_status: "PENDING",
    is_active: true,
    is_verified: false,
    rejection_reason: null,
    created_at: new Date("2026-08-01T09:00:00Z"),
    updated_at: null,
    file_url: "https://ik.imagekit.io/secret.jpg",
    file_path: "/secret.jpg",
    file_id: "ik-1",
    tenant: { owner_id: OWNER_A, profile_id: "profile-1", profile_type: "STUDENT" },
    ...overrides,
  };
}

describe("owner KYC verification — permissions, guards and concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ sub: OWNER_A, role: "OWNER" });
    mockPrisma.identificationDocument.findUnique.mockResolvedValue(document());
    // Conditional review write succeeds by default (one PENDING row transitions).
    mockPrisma.identificationDocument.updateMany.mockResolvedValue({ count: 1 });
    // recomputeDocumentVerified reads these:
    mockPrisma.tenants.findUnique.mockResolvedValue({ id: TENANT_ID, profile_type: "STUDENT", document_verified: false });
    mockPrisma.identificationDocument.findMany.mockResolvedValue([]);
    mockPrisma.tenants.update.mockResolvedValue({});
    mockPrisma.profile.findUnique.mockResolvedValue({ name: "Priya" });
    mockPrisma.notifications.create.mockResolvedValue({});
  });

  describe("approve", () => {
    it("approves a pending document for its own owner", async () => {
      const res = await verifyDocument(request(), params);

      expect(res.status).toBe(200);
      expect(mockPrisma.identificationDocument.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: DOC_ID, document_status: "PENDING" }),
          data: expect.objectContaining({ document_status: "APPROVED", is_verified: true }),
        }),
      );
    });

    it("returns 409 when the document is no longer PENDING (a concurrent decision won)", async () => {
      mockPrisma.identificationDocument.updateMany.mockResolvedValue({ count: 0 });

      const res = await verifyDocument(request(), params);

      expect(res.status).toBe(409);
    });

    it("refuses an owner acting on another owner's tenant", async () => {
      mockSession.mockResolvedValue({ sub: OWNER_B, role: "OWNER" });

      const res = await verifyDocument(request(), params);

      expect(res.status).toBe(403);
      expect(mockPrisma.identificationDocument.updateMany).not.toHaveBeenCalled();
    });

    it("refuses an unauthenticated caller", async () => {
      mockSession.mockResolvedValue(null);
      expect((await verifyDocument(request(), params)).status).toBe(401);
    });

    it("refuses a tenant approving their own document", async () => {
      mockSession.mockResolvedValue({ sub: "profile-1", role: "TENANT" });
      expect((await verifyDocument(request(), params)).status).toBe(401);
    });

    it("refuses an archived document", async () => {
      mockPrisma.identificationDocument.findUnique.mockResolvedValue(document({ is_active: false }));
      expect((await verifyDocument(request(), params)).status).toBe(409);
    });

    it("marks the tenant document-verified only once every required type is approved", async () => {
      mockPrisma.identificationDocument.findMany.mockResolvedValue([
        { doc_type: "AADHAAR", document_status: "APPROVED", is_verified: true, is_active: true },
        { doc_type: "COLLEGE_ID", document_status: "APPROVED", is_verified: true, is_active: true },
      ]);
      mockPrisma.identificationDocument.findUnique.mockImplementation(async ({ include }: any) =>
        include ? document() : { ...document(), document_status: "APPROVED" },
      );

      await verifyDocument(request(), params);

      expect(mockPrisma.tenants.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { document_verified: true } }),
      );
    });

    it("leaves the tenant unverified while a required type is still outstanding", async () => {
      mockPrisma.identificationDocument.findMany.mockResolvedValue([
        { doc_type: "AADHAAR", document_status: "APPROVED", is_verified: true, is_active: true },
      ]);
      await verifyDocument(request(), params);
      expect(mockPrisma.tenants.update).not.toHaveBeenCalled();
    });

    it("tells the tenant their document was approved", async () => {
      await verifyDocument(request(), params);
      expect(mockPrisma.notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ profile_id: "profile-1", title: "Document Approved" }) }),
      );
    });

    it("never returns the underlying file url to the client", async () => {
      mockPrisma.identificationDocument.findUnique.mockImplementation(async ({ include }: any) =>
        include ? document() : { ...document(), document_status: "APPROVED" },
      );
      const body = await (await verifyDocument(request(), params)).json();

      expect(body.data.file_url).toBeUndefined();
      expect(body.data.download_url).toContain(`/api/tenants/${TENANT_ID}/documents/${DOC_ID}/download`);
    });
  });

  describe("reject", () => {
    it("refuses a rejection with no reason", async () => {
      const res = await rejectDocument(request({}), params);
      expect(res.status).toBe(400);
      expect(mockPrisma.identificationDocument.updateMany).not.toHaveBeenCalled();
    });

    it("refuses a whitespace-only reason", async () => {
      expect((await rejectDocument(request({ reason: "   " }), params)).status).toBe(400);
    });

    it("refuses a reason over 800 characters", async () => {
      expect((await rejectDocument(request({ reason: "x".repeat(801) }), params)).status).toBe(400);
    });

    it("records the reason so the tenant can read it", async () => {
      const res = await rejectDocument(request({ reason: "Photo is blurry" }), params);

      expect(res.status).toBe(200);
      const data = mockPrisma.identificationDocument.updateMany.mock.calls[0][0].data;
      expect(data.document_status).toBe("REJECTED");
      expect(JSON.parse(data.rejection_reason)).toEqual([
        expect.objectContaining({ sender: "owner", message: "Photo is blurry" }),
      ]);
    });

    it("appends to an existing thread rather than overwriting the history", async () => {
      mockPrisma.identificationDocument.findUnique.mockResolvedValue(
        document({
          rejection_reason: JSON.stringify([
            { sender: "owner", sender_name: "Priya", message: "First try", timestamp: "2026-08-01T09:00:00.000Z" },
          ]),
        }),
      );

      await rejectDocument(request({ reason: "Still blurry" }), params);

      const thread = JSON.parse(mockPrisma.identificationDocument.updateMany.mock.calls[0][0].data.rejection_reason);
      expect(thread).toHaveLength(2);
      expect(thread[0].message).toBe("First try");
      expect(thread[1].message).toBe("Still blurry");
    });

    it("returns 409 when the document is no longer PENDING", async () => {
      mockPrisma.identificationDocument.updateMany.mockResolvedValue({ count: 0 });
      expect((await rejectDocument(request({ reason: "nope" }), params)).status).toBe(409);
    });

    it("refuses an owner rejecting another owner's tenant document", async () => {
      mockSession.mockResolvedValue({ sub: OWNER_B, role: "OWNER" });
      const res = await rejectDocument(request({ reason: "nope" }), params);
      expect(res.status).toBe(403);
      expect(mockPrisma.identificationDocument.updateMany).not.toHaveBeenCalled();
    });

    it("clears the tenant's verified flag via recompute", async () => {
      mockPrisma.tenants.findUnique.mockResolvedValue({ id: TENANT_ID, profile_type: "STUDENT", document_verified: true });
      await rejectDocument(request({ reason: "Photo is blurry" }), params);
      expect(mockPrisma.tenants.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { document_verified: false } }),
      );
    });

    it("tells the tenant why it was rejected", async () => {
      await rejectDocument(request({ reason: "Photo is blurry" }), params);
      const notification = mockPrisma.notifications.create.mock.calls[0][0].data;
      expect(notification.profile_id).toBe("profile-1");
      expect(notification.message).toContain("Photo is blurry");
    });
  });
});
