import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `POST /api/tenants/activate/agreement-read` — the read gate's evidence.
 *
 * The point of recording this server-side rather than in component state is
 * that a reload must not hand out a free pass, and the evidence has to outlive
 * the session that produced it.
 */

const { mockPrisma, mockLifecycle, mockSubject } = vi.hoisted(() => ({
  mockPrisma: { agreement: { findFirst: vi.fn(), update: vi.fn() } } as any,
  mockLifecycle: { resolveByToken: vi.fn(), resolveForSession: vi.fn() },
  mockSubject: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({
  apiError: (message: string, code: string, status = 400) =>
    new Response(JSON.stringify({ error: { message, code } }), { status }),
  apiResponse: (data: unknown, status = 200) =>
    new Response(JSON.stringify({ success: true, data }), { status }),
}));
vi.mock("@/src/services/tenants/activation-request-subject", () => ({
  activationSubjectFromRequest: mockSubject,
}));
vi.mock("@/src/services/tenants/tenant-invitation-lifecycle-service", () => ({
  tenantInvitationLifecycleService: mockLifecycle,
}));

import { POST as recordRead } from "../app/api/tenants/activate/agreement-read/route";

const HASH = "a".repeat(64);
const FIRST_OPEN = new Date("2026-09-17T10:00:00.000Z");
const TENANT = { id: "tenant-1", hostel_id: "h1" };

const request = (body: Record<string, unknown>) => ({ json: async () => body }) as any;
const updateArgs = () => mockPrisma.agreement.update.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  mockSubject.mockResolvedValue({ ok: true, mode: "token", token: "tok-123" });
  mockLifecycle.resolveByToken.mockResolvedValue({ tenant: { ...TENANT } });
  mockPrisma.agreement.findFirst.mockResolvedValue({
    id: "agr-1",
    tenant_id: "tenant-1",
    document_opened_at: null,
    document_read_completed_at: null,
  });
  mockPrisma.agreement.update.mockImplementation(async ({ data }: any) => ({ id: "agr-1", ...data }));
});

describe("POST /api/tenants/activate/agreement-read", () => {
  it("stamps document_opened_at on the opened stage", async () => {
    const res = await recordRead(request({ token: "tok-123", stage: "opened", content_hash: HASH }));
    expect(res.status).toBe(200);
    expect(updateArgs().data.document_opened_at).toBeInstanceOf(Date);
    expect(updateArgs().data.document_read_completed_at).toBeUndefined();
  });

  it("stamps the completion time and the hash on the completed stage", async () => {
    await recordRead(request({ token: "tok-123", stage: "completed", content_hash: HASH }));
    expect(updateArgs().data.document_read_completed_at).toBeInstanceOf(Date);
    expect(updateArgs().data.document_content_hash).toBe(HASH);
  });

  it("does not move opened_at backwards on a second open", async () => {
    // The first open is the evidence. Re-reading must not reset it.
    mockPrisma.agreement.findFirst.mockResolvedValue({
      id: "agr-1", tenant_id: "tenant-1",
      document_opened_at: FIRST_OPEN, document_read_completed_at: null,
    });
    await recordRead(request({ token: "tok-123", stage: "opened", content_hash: HASH }));
    expect(updateArgs().data.document_opened_at).toEqual(FIRST_OPEN);
  });

  it("backfills opened_at when a completion arrives without one", async () => {
    await recordRead(request({ token: "tok-123", stage: "completed", content_hash: HASH }));
    expect(updateArgs().data.document_opened_at).toBeInstanceOf(Date);
  });

  it("rejects a stage it does not know", async () => {
    const res = await recordRead(request({ token: "tok-123", stage: "skimmed", content_hash: HASH }));
    expect(res.status).toBe(400);
    expect(mockPrisma.agreement.update).not.toHaveBeenCalled();
  });

  it("rejects a content hash that is not 64 hex characters", async () => {
    const res = await recordRead(request({ token: "tok-123", stage: "completed", content_hash: "nope" }));
    expect(res.status).toBe(400);
    expect(mockPrisma.agreement.update).not.toHaveBeenCalled();
  });

  it("requires a valid activation token", async () => {
    mockSubject.mockResolvedValue({ ok: false, code: "VALIDATION_ERROR", message: "Activation token is required" });
    const res = await recordRead(request({ stage: "opened", content_hash: HASH }));
    expect(res.status).toBe(400);
    expect(mockPrisma.agreement.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the tenant has no agreement", async () => {
    mockPrisma.agreement.findFirst.mockResolvedValue(null);
    const res = await recordRead(request({ token: "tok-123", stage: "opened", content_hash: HASH }));
    expect(res.status).toBe(404);
  });

  it("scopes the update to the resolved tenant's own agreement", async () => {
    await recordRead(request({ token: "tok-123", stage: "opened", content_hash: HASH }));
    expect(mockPrisma.agreement.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenant_id: "tenant-1" }) }),
    );
    expect(updateArgs().where).toEqual({ id: "agr-1" });
  });

  it("reports the recorded timestamps back to the caller", async () => {
    const res = await recordRead(request({ token: "tok-123", stage: "completed", content_hash: HASH }));
    const { data } = await res.json();
    expect(data.read_completed_at).toBeTruthy();
  });
});
