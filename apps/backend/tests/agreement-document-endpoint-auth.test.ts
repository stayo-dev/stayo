import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `GET /api/agreements/[id]/document` — the authenticated reader.
 *
 * Unlike the onboarding endpoint, this one takes an agreement id straight from
 * the URL, so authorisation is the whole job. The repo already carries an open
 * IDOR finding on an agreement route; the negative cases below are the point of
 * this file, not padding.
 */

const { mockPrisma, mockSession, mockRenderData } = vi.hoisted(() => ({
  mockPrisma: { agreement: { findUnique: vi.fn() } } as any,
  mockSession: vi.fn(),
  mockRenderData: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({
  getSession: mockSession,
  apiError: (message: string, code: string, status = 400) =>
    new Response(JSON.stringify({ error: { message, code } }), { status }),
  apiResponse: (data: unknown, status = 200) =>
    new Response(JSON.stringify({ success: true, data }), { status }),
}));
vi.mock("@/src/services/tenants/agreement-generation-service", () => ({
  AgreementGenerationService: { getAgreementRenderData: mockRenderData },
  formatAgreementDate: (d: any) => String(d ?? "N/A"),
}));

import { GET as getDocument } from "../app/api/agreements/[id]/document/route";

const AGREEMENT = {
  id: "agr-1",
  status: "SIGNED",
  tenant: { profile_id: "tenant-profile-1" },
  hostel: { owner_id: "owner-1" },
  template: { version_number: 2 },
};

const RENDER_DATA = {
  hostelName: "Shoeb's Mansion",
  hostelAddress: "Plot 14, Gachibowli, Hyderabad, Telangana 500032",
  ownerName: "Mohammed Shoeb",
  tenantName: "B. Vineeth",
  roomNo: "101",
  monthlyRent: 8000,
  advanceDeposit: 16000,
  maintenanceCharge: 0,
  joiningDate: "2026-09-01",
  paymentFrequency: "Monthly",
  hostelRules: { categories: [{ id: "fees", title: "Fees", rules: ["Due on the 5th."] }] },
  termsAndConditions: [],
  tenantSignatureName: "B. Vineeth",
  tenantSignatureUrl: null,
  guardianSignatureName: null,
  guardianSignatureUrl: null,
  guardianRelation: null,
  ownerSignatureUrl: null,
  ownerSignedAt: null,
  agreementStartDate: "2026-09-01",
};

const params = { params: { id: "agr-1" } };
const req = {} as any;

const bodyOf = async (res: Response) => (await res.json()) as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.agreement.findUnique.mockResolvedValue({ ...AGREEMENT });
  mockRenderData.mockResolvedValue({ ...RENDER_DATA });
});

describe("GET /api/agreements/[id]/document", () => {
  it("refuses an unauthenticated request", async () => {
    mockSession.mockResolvedValue(null);
    const res = await getDocument(req, params);
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).data).toBeUndefined();
  });

  it("lets the tenant who signed it read their own agreement", async () => {
    mockSession.mockResolvedValue({ sub: "tenant-profile-1", role: "TENANT" });
    const res = await getDocument(req, params);
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).data.document.blocks[0].kind).toBe("title");
  });

  it("lets the owner of the hostel read it", async () => {
    mockSession.mockResolvedValue({ sub: "owner-1", role: "OWNER" });
    expect((await getDocument(req, params)).status).toBe(200);
  });

  it("refuses a different owner, and returns no document", async () => {
    mockSession.mockResolvedValue({ sub: "owner-2", role: "OWNER" });
    const res = await getDocument(req, params);
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).data).toBeUndefined();
  });

  it("refuses a different tenant, and returns no document", async () => {
    mockSession.mockResolvedValue({ sub: "tenant-profile-2", role: "TENANT" });
    const res = await getDocument(req, params);
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).data).toBeUndefined();
  });

  it("does not grant access when the agreement's tenant has no profile linked", async () => {
    // tenants.profile_id is nullable. A null must never compare equal to a
    // caller's subject, or an unlinked tenancy becomes readable by anyone.
    mockPrisma.agreement.findUnique.mockResolvedValue({ ...AGREEMENT, tenant: { profile_id: null } });
    mockSession.mockResolvedValue({ sub: "tenant-profile-1", role: "TENANT" });
    expect((await getDocument(req, params)).status).toBe(403);
  });

  it("returns 404 for an agreement that does not exist", async () => {
    mockPrisma.agreement.findUnique.mockResolvedValue(null);
    mockSession.mockResolvedValue({ sub: "owner-1", role: "OWNER" });
    expect((await getDocument(req, params)).status).toBe(404);
  });

  it("renders from the agreement's own snapshot, not the current template", async () => {
    mockSession.mockResolvedValue({ sub: "owner-1", role: "OWNER" });
    await getDocument(req, params);
    // A signed agreement must render from what was signed.
    expect(mockRenderData).toHaveBeenCalledWith("agr-1");
  });
});
