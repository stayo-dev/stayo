import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Bulk verify and the MARK_DOCUMENTS_VERIFIED compliance action share one core
 * (`approveRequiredActiveKycDocs`): both may only approve the *required* active
 * documents for the tenant's profile_type, both refuse when a required type was
 * never uploaded, and both derive `document_verified` via the shared helper —
 * never from a bare count. See spec §12, §13.
 */

const { mockPrisma, mockSession, mockEventLog } = vi.hoisted(() => {
  const identificationDocument = { findMany: vi.fn(), updateMany: vi.fn() };
  const tenants = { findUnique: vi.fn(), update: vi.fn() };
  const notifications = { create: vi.fn() };
  const prisma: any = {
    identificationDocument,
    tenants,
    notifications,
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
vi.mock("@/lib/auth", () => ({
  getSession: mockSession,
  apiError: (message: string, code: string, status = 400) =>
    new Response(JSON.stringify({ error: { message, code } }), { status }),
  apiResponse: (data: unknown, status = 200) =>
    new Response(JSON.stringify({ success: true, data }), { status }),
}));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: mockEventLog }));
// The compliance-action route pulls in invitation-service (→ email-service →
// Resend) for other action branches. MARK_DOCUMENTS_VERIFIED needs none of it.
vi.mock("@/src/services/tenants/invitation-service", () => ({ invitationService: {} }));
vi.mock("@/lib/config/domains", () => ({
  backendUrl: (p: string) => `https://api.test${p}`,
  frontendUrl: (p: string) => `https://app.test${p}`,
}));

import { PATCH as bulkVerify } from "../app/api/tenants/[id]/documents/bulk-verify/route";
import { POST as complianceAction } from "../app/api/tenants/[id]/compliance-action/route";

const OWNER = "owner-1";
const OTHER_OWNER = "owner-2";
const TENANT_ID = "tenant-1";

const req = (body?: unknown) => ({ json: async () => body ?? {} }) as any;
const params = { params: { id: TENANT_ID } } as any;

const active = (doc_type: string, status = "PENDING") => ({
  id: `d-${doc_type}`,
  doc_type,
  document_status: status,
  is_verified: status === "APPROVED",
  is_active: true,
});

/**
 * The route calls `identificationDocument.findMany` twice: once in
 * `approveRequiredActiveKycDocs` (sees them un-approved and flips them), then
 * once in `recomputeDocumentVerified` (must see the result). The mock does not
 * mutate, so stage the two return values.
 */
function stageDocs(beforeApproval: any[], afterApproval = beforeApproval.map((d) => ({ ...d, document_status: "APPROVED", is_verified: true }))) {
  mockPrisma.identificationDocument.findMany
    .mockResolvedValueOnce(beforeApproval)
    .mockResolvedValue(afterApproval);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ sub: OWNER, role: "OWNER" });
  mockPrisma.tenants.findUnique.mockResolvedValue({
    id: TENANT_ID,
    owner_id: OWNER,
    profile_id: "profile-1",
    profile_type: "STUDENT",
    document_verified: false,
    profiles: { name: "Aarav" },
    hostels: { name: "Sunrise" },
    tenant_invitations: [],
  });
  mockPrisma.identificationDocument.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.tenants.update.mockResolvedValue({});
  mockPrisma.notifications.create.mockResolvedValue({});
});

describe("bulk-verify", () => {
  it("approves the required active docs and derives document_verified", async () => {
    stageDocs([active("AADHAAR"), active("COLLEGE_ID")]);

    const res = await bulkVerify(req(), params);
    expect(res.status).toBe(200);
    expect(mockPrisma.identificationDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ document_status: "APPROVED" }) }),
    );
    expect(mockPrisma.tenants.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { document_verified: true } }),
    );
  });

  it("refuses (409) when a required type has no active document", async () => {
    stageDocs([active("AADHAAR")]);

    const res = await bulkVerify(req(), params);
    expect(res.status).toBe(409);
    expect(mockPrisma.identificationDocument.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.tenants.update).not.toHaveBeenCalled();
  });

  it("refuses an owner acting on another owner's tenant", async () => {
    mockSession.mockResolvedValue({ sub: OTHER_OWNER, role: "OWNER" });
    const res = await bulkVerify(req(), params);
    expect(res.status).toBe(403);
  });

  it("only queries this tenant's active required docs", async () => {
    stageDocs([active("AADHAAR"), active("COLLEGE_ID")]);
    await bulkVerify(req(), params);
    expect(mockPrisma.identificationDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: TENANT_ID,
          is_active: true,
          doc_type: { in: ["AADHAAR", "COLLEGE_ID"] },
        }),
      }),
    );
  });
});

describe("MARK_DOCUMENTS_VERIFIED compliance action", () => {
  it("cannot verify a tenant whose required document is missing", async () => {
    stageDocs([active("AADHAAR")]);

    const res = await complianceAction(req({ action: "MARK_DOCUMENTS_VERIFIED" }), params);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("INCOMPLETE_KYC");
    expect(mockPrisma.tenants.update).not.toHaveBeenCalled();
  });

  it("approves required docs and derives document_verified when all present", async () => {
    stageDocs([active("AADHAAR"), active("COLLEGE_ID")]);

    const res = await complianceAction(req({ action: "MARK_DOCUMENTS_VERIFIED" }), params);
    expect(res.status).toBe(200);
    expect(mockPrisma.tenants.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { document_verified: true } }),
    );
  });

  it("refuses another owner's tenant", async () => {
    mockSession.mockResolvedValue({ sub: OTHER_OWNER, role: "OWNER" });
    const res = await complianceAction(req({ action: "MARK_DOCUMENTS_VERIFIED" }), params);
    expect(res.status).toBe(403);
  });
});
