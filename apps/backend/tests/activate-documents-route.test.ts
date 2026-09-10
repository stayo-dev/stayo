import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `POST /api/tenants/activate/documents` — the activation-phase KYC upload.
 *
 * Token OR session (like `/activate/photo`), same validation and same
 * `identification_documents` rows as `/me/documents`. Uploads land PENDING and
 * never block onboarding.
 */

const { mockPrisma, mockLifecycle, mockSubject, mockImagekit, mockEventLog } = vi.hoisted(() => {
  const identificationDocument = {
    updateMany: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
  };
  const tenants = { findUnique: vi.fn(), update: vi.fn() };
  const prisma: any = {
    identificationDocument,
    tenants,
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };
  return {
    mockPrisma: prisma,
    mockLifecycle: { resolveByToken: vi.fn(), resolveForSession: vi.fn() },
    mockSubject: vi.fn(),
    mockImagekit: { files: { upload: vi.fn() } },
    mockEventLog: { log: vi.fn().mockResolvedValue({}) },
  };
});

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/imagekit", () => ({ imagekit: mockImagekit }));
vi.mock("@/lib/onboarding-metrics", () => ({ withOnboardingMetrics: (res: any) => res }));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: mockEventLog }));
vi.mock("@/lib/config/domains", () => ({ backendUrl: (p: string) => `https://api.test${p}` }));
vi.mock("@/lib/auth", () => ({
  apiError: (message: string, code: string, status = 400) =>
    new Response(JSON.stringify({ error: { message, code } }), { status }),
  apiResponse: (data: unknown, status = 200) =>
    new Response(JSON.stringify({ success: true, data }), { status }),
}));
vi.mock("@/src/services/tenants/tenant-invitation-lifecycle-service", () => ({
  tenantInvitationLifecycleService: mockLifecycle,
}));
vi.mock("@/src/services/tenants/activation-request-subject", () => ({
  activationSubjectFromRequest: mockSubject,
}));

import { POST as uploadActivationDoc } from "../app/api/tenants/activate/documents/route";

const TENANT = { id: "tenant-1", owner_id: "owner-1", hostel_id: "h1", profile_id: "profile-1", profile_type: "STUDENT" };

function file({ type = "image/jpeg", size = 1024, name = "aadhaar.jpg" } = {}) {
  return { type, size, name, arrayBuffer: async () => new ArrayBuffer(size) };
}

function formData(entries: Record<string, unknown>) {
  return {
    get: (k: string) => (k in entries ? entries[k] : null),
  };
}

function request(entries: Record<string, unknown>) {
  return { formData: async () => formData(entries) } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSubject.mockResolvedValue({ ok: true, mode: "token", token: "tok-123" });
  mockLifecycle.resolveByToken.mockResolvedValue({ tenant: { ...TENANT } });
  mockLifecycle.resolveForSession.mockResolvedValue({ tenant: { ...TENANT } });
  mockImagekit.files.upload.mockResolvedValue({
    url: "https://ik.imagekit.io/x/aadhaar.jpg",
    filePath: "/x/aadhaar.jpg",
    fileId: "ik-1",
  });
  mockPrisma.identificationDocument.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.identificationDocument.create.mockImplementation(async ({ data }: any) => ({ id: "new-doc", ...data }));
  mockPrisma.identificationDocument.findMany.mockResolvedValue([]);
  mockPrisma.tenants.findUnique.mockResolvedValue({ id: TENANT.id, profile_type: "STUDENT", document_verified: false });
  mockPrisma.tenants.update.mockResolvedValue({});
});

describe("POST /api/tenants/activate/documents", () => {
  it("uploads a required document as PENDING and archives the previous active one", async () => {
    const res = await uploadActivationDoc(request({ token: "tok-123", doc_type: "AADHAAR", file: file() }));

    expect(res.status).toBe(201);
    expect(mockImagekit.files.upload).toHaveBeenCalled();
    expect(mockPrisma.identificationDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenant_id: "tenant-1", doc_type: "AADHAAR", is_active: true }), data: { is_active: false } }),
    );
    expect(mockPrisma.identificationDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ document_status: "PENDING", is_verified: false }) }),
    );

    const body = await res.json();
    expect(body.data.file_url).toBeUndefined();
    expect(body.data.download_url).toContain("/documents/new-doc/download");
  });

  it("works from a session with no token", async () => {
    mockSubject.mockResolvedValue({ ok: true, mode: "session", tenantId: "tenant-1" });
    const res = await uploadActivationDoc(request({ doc_type: "COLLEGE_ID", file: file({ name: "college.pdf", type: "application/pdf" }) }));
    expect(res.status).toBe(201);
    expect(mockLifecycle.resolveForSession).toHaveBeenCalledWith("tenant-1");
  });

  it("rejects a document type the profile does not require (Work ID for a student)", async () => {
    const res = await uploadActivationDoc(request({ token: "tok-123", doc_type: "WORK_ID", file: file() }));
    expect(res.status).toBe(400);
    expect(mockImagekit.files.upload).not.toHaveBeenCalled();
  });

  it("rejects a disallowed MIME type", async () => {
    const res = await uploadActivationDoc(request({ token: "tok-123", doc_type: "AADHAAR", file: file({ type: "image/gif" }) }));
    expect(res.status).toBe(400);
  });

  it("rejects a file over 5MB", async () => {
    const res = await uploadActivationDoc(request({ token: "tok-123", doc_type: "AADHAAR", file: file({ size: 6 * 1024 * 1024 }) }));
    expect(res.status).toBe(400);
  });

  it("400s when neither a token nor a session resolves", async () => {
    mockSubject.mockResolvedValue({ ok: false });
    const res = await uploadActivationDoc(request({ doc_type: "AADHAAR", file: file() }));
    expect(res.status).toBe(400);
  });

  it("recomputes document_verified after the upload", async () => {
    await uploadActivationDoc(request({ token: "tok-123", doc_type: "AADHAAR", file: file() }));
    // recomputeDocumentVerified reads the tenant + its active docs
    expect(mockPrisma.tenants.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tenant-1" } }),
    );
  });
});
