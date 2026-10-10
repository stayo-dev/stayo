import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `GET /api/tenants/[id]/documents/[docId]/download` for a signed agreement
 * that has no stored PDF.
 *
 * Signing generates the PDF *after* the agreement is committed and only logs a
 * failure, so a SIGNED agreement can have `pdf_url = null`. The route used to
 * answer 404 ("This document is no longer available.") for those; it now
 * renders the PDF from the agreement's snapshot, stores it best-effort, and
 * serves it.
 */

const { mockPrisma, mockSession, mockRender, mockStore } = vi.hoisted(() => ({
  mockPrisma: {
    identificationDocument: { findUnique: vi.fn() },
    agreement: { findFirst: vi.fn() },
  } as any,
  mockSession: vi.fn(),
  mockRender: vi.fn(),
  mockStore: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ getSession: mockSession }));
vi.mock("@/src/services/tenants/agreement-generation-service", () => ({
  AgreementGenerationService: { renderPdf: mockRender, storePdf: mockStore },
}));

import { GET } from "../app/api/tenants/[id]/documents/[docId]/download/route";

const PARAMS = { params: { id: "tenant-1", docId: "agr-1" } };
const AGREEMENT = {
  id: "agr-1",
  tenant_id: "tenant-1",
  status: "SIGNED",
  pdf_url: null,
  tenant: { id: "tenant-1", profile_id: "profile-1", owner_id: "owner-1" },
};
const PDF = Buffer.from("%PDF-1.7 test");

const call = () => GET({} as any, PARAMS);

describe("agreement download — PDF missing from storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockPrisma.identificationDocument.findUnique.mockResolvedValue(null);
    mockPrisma.agreement.findFirst.mockResolvedValue(AGREEMENT);
    mockSession.mockResolvedValue({ sub: "owner-1", role: "OWNER" });
    mockRender.mockResolvedValue(PDF);
    mockStore.mockResolvedValue("https://ik.example/agreement.pdf");
  });

  it("renders, stores and serves the PDF instead of answering 404", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(PDF.toString());
    expect(mockRender).toHaveBeenCalledWith("agr-1");
    expect(mockStore).toHaveBeenCalledWith("agr-1", PDF);
  });

  it("still serves the PDF when storing it fails", async () => {
    mockStore.mockRejectedValue(new Error("imagekit down"));
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  it("answers 502 when the PDF cannot be rendered", async () => {
    mockRender.mockRejectedValue(new Error("font missing"));
    const res = await call();
    expect(res.status).toBe(502);
  });

  it("checks access before rendering anything", async () => {
    mockSession.mockResolvedValue({ sub: "someone-else", role: "OWNER" });
    const res = await call();
    expect(res.status).toBe(403);
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("still 404s for an agreement that is not document-accessible", async () => {
    mockPrisma.agreement.findFirst.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(mockRender).not.toHaveBeenCalled();
  });
});
