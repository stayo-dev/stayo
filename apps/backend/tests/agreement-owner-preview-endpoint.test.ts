import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `POST /api/owner/hostels/[id]/agreement-template/document` — the owner's
 * preview.
 *
 * It returns the *same* `AgreementDocument` the tenant reads and the PDF is
 * made from. That is the whole point: the previous editor previewed a
 * hand-rolled approximation that omitted the preamble, the standard legal
 * clauses, the execution statement and the signature block, so an owner
 * approved one document and issued another.
 */

const { mockPrisma, mockSession } = vi.hoisted(() => ({
  mockPrisma: { hostels: { findFirst: vi.fn() } } as any,
  mockSession: vi.fn(),
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

import { POST as previewDocument } from "../app/api/owner/hostels/[id]/agreement-template/document/route";

const HOSTEL = {
  id: "h1",
  name: "Shoeb's Mansion",
  address: "Plot 14, Gachibowli, Hyderabad, Telangana 500032",
  owner_id: "owner-1",
  profiles: { name: "Mohammed Shoeb" },
};

const params = { params: { id: "h1" } };
const request = (body: any) => ({ json: async () => body }) as any;

const draft = {
  categories: [{ id: "fees", title: "Fees", rules: ["Rent is {{MONTHLY_RENT}} per month."] }],
  terms_and_conditions: [{ id: "notice_period", title: "Renamed By Client", content: "Sixty days." }],
};

const sections = async (res: Response) =>
  ((await res.json()).data.document.blocks as any[]).filter((b) => b.kind === "section");

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ sub: "owner-1", role: "OWNER" });
  mockPrisma.hostels.findFirst.mockResolvedValue({ ...HOSTEL });
});

describe("POST /api/owner/hostels/[id]/agreement-template/document", () => {
  it("refuses a tenant", async () => {
    mockSession.mockResolvedValue({ sub: "t1", role: "TENANT" });
    const res = await previewDocument(request({ rules_content: draft }), params);
    expect(res.status).toBe(403);
    expect((await res.json()).data).toBeUndefined();
  });

  it("refuses an owner who does not own the hostel", async () => {
    mockPrisma.hostels.findFirst.mockResolvedValue(null);
    const res = await previewDocument(request({ rules_content: draft }), params);
    expect(res.status).toBe(404);
    expect((await res.json()).data).toBeUndefined();
  });

  it("scopes the hostel lookup to the caller, never a first-hostel fallback", async () => {
    await previewDocument(request({ rules_content: draft }), params);
    expect(mockPrisma.hostels.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "h1", owner_id: "owner-1" }) }),
    );
  });

  it("composes the draft the owner sent, not what is published", async () => {
    const res = await previewDocument(request({ rules_content: draft }), params);
    expect(res.status).toBe(200);
    expect((await sections(res)).map((s) => s.title)).toContain("Fees");
  });

  it("fills sample values so the preview reads like a real agreement", async () => {
    const res = await previewDocument(request({ rules_content: draft }), params);
    const fees = (await sections(res)).find((s) => s.title === "Fees");
    expect(fees.clauses[0].text).not.toContain("{{MONTHLY_RENT}}");
    expect(fees.clauses[0].text).toMatch(/Rent is .+ per month\./);
  });

  it("includes the platform band and the execution furniture", async () => {
    const res = await previewDocument(request({ rules_content: draft }), params);
    // One read: a Response body is single-use.
    const blocks = (await res.json()).data.document.blocks as any[];
    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toContain("execution");
    expect(kinds).toContain("attestation");
    expect(blocks.filter((b) => b.kind === "section").some((s) => s.origin === "platform")).toBe(true);
  });

  it("normalizes the terms band, so a renamed term comes back canonical", async () => {
    const res = await previewDocument(request({ rules_content: draft }), params);
    const titles = (await sections(res)).map((s) => s.title);
    expect(titles).toContain("Notice Period");
    expect(titles).not.toContain("Renamed By Client");
  });

  it("keeps the owner's wording for a term they did edit", async () => {
    const res = await previewDocument(request({ rules_content: draft }), params);
    const notice = (await sections(res)).find((s) => s.title === "Notice Period");
    expect(notice.clauses[0].text).toBe("Sixty days.");
  });

  it("leaves an unknown token visible, because the owner can still fix it", async () => {
    const typo = { categories: [{ id: "a", title: "Fees", rules: ["Rent is {{MONTLY_RENT}}."] }] };
    const res = await previewDocument(request({ rules_content: typo }), params);
    const fees = (await sections(res)).find((s) => s.title === "Fees");
    expect(fees.clauses[0].text).toContain("MONTLY_RENT");
  });

  it("falls back to the stock template when no draft is sent", async () => {
    const res = await previewDocument(request({}), params);
    expect(res.status).toBe(200);
    expect((await sections(res)).length).toBeGreaterThan(0);
  });
});
