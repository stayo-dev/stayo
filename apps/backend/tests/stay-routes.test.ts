import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSession, mockStay, mockAssert } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockStay: { getMyStay: vi.fn(), recordStayEvent: vi.fn(), getHostelBoard: vi.fn(), getPortfolioSummary: vi.fn() },
  mockAssert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({
  getSession: mockSession,
  apiError: (message: string, code: string, status = 500) =>
    new Response(JSON.stringify({ success: false, error: { message, code } }), { status }),
  apiResponse: (data: any, status = 200) => new Response(JSON.stringify({ success: true, ...data }), { status }),
}));
vi.mock("@/lib/security/scoped-query", () => ({
  assertHostelBelongsToOwner: mockAssert,
  requireHostelBelongsToOwner: mockAssert,
}));
vi.mock("@/src/services/stay/stay-service", () => ({ stayService: mockStay }));

import { GET as getMine } from "../app/api/tenant/stay/route";
import { POST as tenantEvent } from "../app/api/tenant/stay/events/route";
import { GET as getBoard } from "../app/api/hostels/[id]/stay/route";
import { POST as ownerEvent } from "../app/api/hostels/[id]/stay/tenants/[tenantId]/events/route";
import { GET as getSummary } from "../app/api/owner/stay/summary/route";
import { StayError } from "@/src/services/stay/stay-errors";

const HOSTEL = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const TENANT_SESSION = { sub: "p-tenant", role: "TENANT" };
const OWNER_SESSION = { sub: "o1", owner_id: "o1", role: "OWNER" };
const req = (body: unknown = {}) => ({ json: async () => body, url: "http://test/api" }) as any;
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as any;
const RESIDENT = { tenantId: TENANT, hostel: { id: HOSTEL, name: "Sri Adithya" }, resident: true, stay: { status: "PRESENT" } };

beforeEach(() => {
  vi.clearAllMocks();
  mockAssert.mockResolvedValue({ id: HOSTEL });
});

describe("tenant routes", () => {
  it("only tenants may read or write their stay", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    expect((await getMine(req())).status).toBe(403);
    expect((await tenantEvent(req({ type: "RETURNED", source: "QR" }))).status).toBe(403);
  });

  it("records for the session's own tenancy — a body tenantId is ignored", async () => {
    mockSession.mockResolvedValue(TENANT_SESSION);
    mockStay.getMyStay.mockResolvedValue(RESIDENT);
    mockStay.recordStayEvent.mockResolvedValue({ status: "PRESENT" });
    const res = await tenantEvent(req({ type: "RETURNED", source: "QR", idempotencyKey: "tap-0001-abcd", tenantId: "someone-else" }));
    expect(res.status).toBe(200);
    expect(mockStay.recordStayEvent).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT, hostelId: HOSTEL, type: "RETURNED", source: "QR", actorProfileId: "p-tenant", actorRole: "TENANT",
    }));
  });

  it("refuses a non-resident with STAY_INELIGIBLE", async () => {
    mockSession.mockResolvedValue(TENANT_SESSION);
    mockStay.getMyStay.mockResolvedValue({ ...RESIDENT, resident: false, stay: null });
    const res = await tenantEvent(req({ type: "RETURNED", source: "APP", idempotencyKey: "tap-0001-abcd" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("STAY_INELIGIBLE");
    expect(mockStay.recordStayEvent).not.toHaveBeenCalled();
  });

  it("only accepts QR or APP as a tenant source", async () => {
    mockSession.mockResolvedValue(TENANT_SESSION);
    expect((await tenantEvent(req({ type: "RETURNED", source: "OWNER" }))).status).toBe(400);
  });

  it("carries a StayError's status and code through", async () => {
    mockSession.mockResolvedValue(TENANT_SESSION);
    mockStay.getMyStay.mockResolvedValue(RESIDENT);
    mockStay.recordStayEvent.mockRejectedValue(new StayError("TOO_SOON", "Pick a return date from tomorrow onwards.", 400));
    const res = await tenantEvent(req({ type: "LEAVE_STARTED", source: "APP", idempotencyKey: "tap-0001-abcd" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({ message: "Pick a return date from tomorrow onwards.", code: "TOO_SOON" });
  });
});

describe("owner routes", () => {
  it("scopes the board to a hostel the owner owns", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    mockStay.getHostelBoard.mockResolvedValue({ hereTonight: 3 });
    const res = await getBoard(req(), ctx({ id: HOSTEL }));
    expect(res.status).toBe(200);
    expect(mockAssert).toHaveBeenCalledWith("o1", HOSTEL);
  });

  it("refuses another owner's hostel", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    mockAssert.mockRejectedValue(Object.assign(new Error("FORBIDDEN: not yours"), { code: "FORBIDDEN" }));
    expect((await getBoard(req(), ctx({ id: HOSTEL }))).status).toBe(403);
    expect(mockStay.getHostelBoard).not.toHaveBeenCalled();
  });

  it("records an owner update with source OWNER and the path's hostel", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    mockStay.recordStayEvent.mockResolvedValue({ status: "PRESENT" });
    const res = await ownerEvent(req({ type: "RETURNED", idempotencyKey: "tap-0001-abcd", source: "QR" }), ctx({ id: HOSTEL, tenantId: TENANT }));
    expect(res.status).toBe(200);
    expect(mockStay.recordStayEvent).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT, hostelId: HOSTEL, source: "OWNER", actorRole: "OWNER", actorProfileId: "o1",
    }));
  });

  it("does not let an owner confirm presence, and rejects a malformed tenant id", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    expect((await ownerEvent(req({ type: "PRESENCE_CONFIRMED" }), ctx({ id: HOSTEL, tenantId: TENANT }))).status).toBe(400);
    expect((await ownerEvent(req({ type: "RETURNED" }), ctx({ id: HOSTEL, tenantId: "nope" }))).status).toBe(404);
  });

  it("summarises the whole portfolio for the session owner", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    mockStay.getPortfolioSummary.mockResolvedValue({ totals: {}, hostels: [] });
    expect((await getSummary(req())).status).toBe(200);
    expect(mockStay.getPortfolioSummary).toHaveBeenCalledWith("o1");
  });

  it("keeps tenants out of owner routes", async () => {
    mockSession.mockResolvedValue(TENANT_SESSION);
    expect((await getBoard(req(), ctx({ id: HOSTEL }))).status).toBe(403);
    expect((await getSummary(req())).status).toBe(403);
  });
});
