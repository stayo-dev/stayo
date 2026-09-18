import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `GET /api/tenants/activate/agreement-document` — the document a tenant reads
 * before signing.
 *
 * Token-authenticated, not session-authenticated: onboarding happens before the
 * tenant has an account, so this cannot sit behind `getSession`. The subject is
 * a discriminated union rather than a tenant id, so token mode has to go
 * through the lifecycle service to reach a tenant.
 */

const { mockPrisma, mockLifecycle, mockSubject, mockRenderData } = vi.hoisted(() => {
  const prisma: any = { agreement: { findFirst: vi.fn() } };
  return {
    mockPrisma: prisma,
    mockLifecycle: { resolveByToken: vi.fn(), resolveForSession: vi.fn() },
    mockSubject: vi.fn(),
    mockRenderData: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({
  apiError: (message: string, code: string, status = 400) =>
    new Response(JSON.stringify({ error: { message, code } }), { status }),
  // Matches lib/auth-edge.ts: an object is SPREAD at the top level, it is not
  // nested under `data`. The mock used to nest it, which would have let a
  // response-shape bug through unnoticed.
  apiResponse: (data: unknown, status = 200) =>
    new Response(
      JSON.stringify(
        typeof data === 'object' && data !== null && !Array.isArray(data)
          ? { success: true, ...(data as object) }
          : { success: true, data },
      ),
      { status },
    ),
}));
vi.mock("@/src/services/tenants/activation-request-subject", () => ({
  activationSubjectFromRequest: mockSubject,
}));
vi.mock("@/src/services/tenants/tenant-invitation-lifecycle-service", () => ({
  tenantInvitationLifecycleService: mockLifecycle,
}));
vi.mock("@/src/services/tenants/agreement-generation-service", () => ({
  AgreementGenerationService: { getAgreementRenderData: mockRenderData },
  formatAgreementDate: (d: any) => String(d ?? "N/A"),
}));

import { GET as getAgreementDocument } from "../app/api/tenants/activate/agreement-document/route";

const TENANT = { id: "tenant-1", owner_id: "owner-1", hostel_id: "h1", profile_id: "profile-1" };

const AGREEMENT = {
  id: "agr-1",
  tenant_id: "tenant-1",
  status: "DRAFT",
  generated_at: new Date("2026-09-01T00:00:00.000Z"),
  template: { version_number: 4 },
};

const RENDER_DATA = {
  hostelName: "Shoeb's Mansion",
  hostelAddress: "Plot 14, Gachibowli, Hyderabad, Telangana 500032",
  ownerName: "Mohammed Shoeb",
  tenantName: "B. Vineeth",
  roomNo: "101",
  monthlyRent: 8000,
  advanceDeposit: 16000,
  maintenanceCharge: 500,
  joiningDate: "2026-09-01",
  paymentFrequency: "Monthly",
  hostelRules: { categories: [{ id: "fees", title: "Fees", rules: ["Rent is {{MONTHLY_RENT}}."] }] },
  termsAndConditions: [{ title: "Notice Period", content: "Thirty days." }],
  tenantSignatureName: null,
  tenantSignatureUrl: null,
  guardianSignatureName: null,
  guardianSignatureUrl: null,
  guardianRelation: null,
  ownerSignatureUrl: null,
  ownerSignedAt: null,
  agreementStartDate: "2026-09-01",
};

const request = (token?: string) =>
  ({ nextUrl: { searchParams: new URLSearchParams(token ? `token=${token}` : "") } }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockSubject.mockResolvedValue({ ok: true, mode: "token", token: "tok-123" });
  mockLifecycle.resolveByToken.mockResolvedValue({ tenant: { ...TENANT } });
  mockLifecycle.resolveForSession.mockResolvedValue({ tenant: { ...TENANT } });
  mockPrisma.agreement.findFirst.mockResolvedValue({ ...AGREEMENT });
  mockRenderData.mockResolvedValue({ ...RENDER_DATA });
});

describe("GET /api/tenants/activate/agreement-document", () => {
  it("refuses a request with no token and no session", async () => {
    mockSubject.mockResolvedValue({ ok: false, code: "VALIDATION_ERROR", message: "Activation token is required" });
    const res = await getAgreementDocument(request());
    expect(res.status).toBe(400);
    expect((await res.json()).document).toBeUndefined();
  });

  it("refuses an expired or invalid activation link", async () => {
    mockLifecycle.resolveByToken.mockResolvedValue({ tenant: null });
    const res = await getAgreementDocument(request("tok-123"));
    expect(res.status).toBe(410);
  });

  it("returns 404 when the tenant has no agreement yet", async () => {
    mockPrisma.agreement.findFirst.mockResolvedValue(null);
    const res = await getAgreementDocument(request("tok-123"));
    expect(res.status).toBe(404);
  });

  it("returns the composed document for a valid token", async () => {
    const res = await getAgreementDocument(request("tok-123"));
    expect(res.status).toBe(200);

    const { document } = await res.json();
    expect(document.blocks[0].kind).toBe("title");
    expect(document.blocks.map((b: any) => b.kind)).toContain("execution");
    expect(document.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("shows the owner's own clauses, interpolated", async () => {
    const res = await getAgreementDocument(request("tok-123"));
    const { document } = await res.json();

    const rules = document.blocks.find((b: any) => b.kind === "section" && b.band === "rules");
    // The whole point of this endpoint: the owner's wording, with real numbers.
    expect(rules.title).toBe("Fees");
    expect(rules.clauses[0].text).toBe("Rent is 8000.");
  });

  it("carries the published template version so the reader can label it", async () => {
    const res = await getAgreementDocument(request("tok-123"));
    expect((await res.json()).document.meta.versionNumber).toBe(4);
  });

  it("scopes the lookup to the resolved tenant, never a bare agreement id", async () => {
    await getAgreementDocument(request("tok-123"));
    expect(mockPrisma.agreement.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenant_id: "tenant-1" }) }),
    );
  });

  it("resolves a session subject through the session path, not the token path", async () => {
    mockSubject.mockResolvedValue({ ok: true, mode: "session", tenantId: "tenant-1" });
    await getAgreementDocument(request());
    expect(mockLifecycle.resolveForSession).toHaveBeenCalledWith("tenant-1");
    expect(mockLifecycle.resolveByToken).not.toHaveBeenCalled();
  });
});
