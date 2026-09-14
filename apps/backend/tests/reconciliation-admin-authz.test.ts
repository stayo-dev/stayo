/**
 * `/api/admin/finance/reconciliation/*` is platform-admin only (C2,
 * 2026-09-14 audit). These routes gated on `role === "OWNER"`, so any owner —
 * owner signup is public — could list every owner's reconciliation issues,
 * mutate any issue, and run/persist a platform-wide scan. A caller-supplied
 * `ownerId` made the read cross-owner by construction.
 *
 * Real route handlers; only the session, database and scan service are faked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSession, prisma, recon } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  prisma: {
    financial_reconciliation_issues: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
  recon: { detectAll: vi.fn(), persistIssues: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/auth", () => ({
  getSession: mockSession,
  apiError: (message: string, code: string, status = 500) =>
    new Response(JSON.stringify({ success: false, error: { message, code } }), { status }),
  apiResponse: (data: any, status = 200) => new Response(JSON.stringify({ success: true, ...data }), { status }),
}));
vi.mock("@/lib/services/financial-reconciliation-service", () => ({ financialReconciliationService: recon }));

import { GET as listIssues } from "../app/api/admin/finance/reconciliation/issues/route";
import { PATCH as patchIssue } from "../app/api/admin/finance/reconciliation/issues/[issueId]/route";
import { POST as scan } from "../app/api/admin/finance/reconciliation/scan/route";

const OWNER = { sub: "11111111-1111-4111-8111-111111111111", owner_id: "11111111-1111-4111-8111-111111111111", role: "OWNER" };
const ADMIN = { sub: "22222222-2222-4222-8222-222222222222", role: "ADMIN" };
const VICTIM_OWNER = "33333333-3333-4333-8333-333333333333";
const ISSUE_ID = "44444444-4444-4444-8444-444444444444";

const listReq = (qs = "") => ({ url: `http://test/api/admin/finance/reconciliation/issues${qs}` }) as any;
const patchReq = (body: unknown) => ({ json: async () => body, url: "http://test" }) as any;
const patchCtx = () => ({ params: Promise.resolve({ issueId: ISSUE_ID }) }) as any;
const scanReq = (body: unknown = {}) => ({ json: async () => body, url: "http://test" }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  prisma.financial_reconciliation_issues.findMany.mockResolvedValue([]);
  prisma.financial_reconciliation_issues.findUnique.mockResolvedValue({ id: ISSUE_ID, status: "OPEN" });
  prisma.financial_reconciliation_issues.update.mockResolvedValue({ id: ISSUE_ID, status: "RESOLVED" });
  recon.detectAll.mockResolvedValue({ started_at: 0, finished_at: 1, total_ms: 1, summary: {}, issues: [] });
  recon.persistIssues.mockResolvedValue({ created: 0 });
});

describe("GET issues", () => {
  it("401 without a session", async () => {
    mockSession.mockResolvedValue(null);
    expect((await listIssues(listReq())).status).toBe(401);
    expect(prisma.financial_reconciliation_issues.findMany).not.toHaveBeenCalled();
  });

  it("403 for an OWNER, before any query runs", async () => {
    mockSession.mockResolvedValue(OWNER);
    const res = await listIssues(listReq());
    expect(res.status).toBe(403);
    expect(prisma.financial_reconciliation_issues.findMany).not.toHaveBeenCalled();
  });

  it("an OWNER cannot reveal another owner's issues via ?ownerId", async () => {
    mockSession.mockResolvedValue(OWNER);
    const res = await listIssues(listReq(`?ownerId=${VICTIM_OWNER}`));
    expect(res.status).toBe(403);
    expect(prisma.financial_reconciliation_issues.findMany).not.toHaveBeenCalled();
  });

  it("200 for an ADMIN", async () => {
    mockSession.mockResolvedValue(ADMIN);
    const res = await listIssues(listReq());
    expect(res.status).toBe(200);
    expect(prisma.financial_reconciliation_issues.findMany).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed ownerId filter with 400 (admin)", async () => {
    mockSession.mockResolvedValue(ADMIN);
    const res = await listIssues(listReq("?ownerId=not-a-uuid"));
    expect(res.status).toBe(400);
    expect(prisma.financial_reconciliation_issues.findMany).not.toHaveBeenCalled();
  });
});

describe("PATCH issue", () => {
  it("401 without a session", async () => {
    mockSession.mockResolvedValue(null);
    expect((await patchIssue(patchReq({ status: "RESOLVED" }), patchCtx())).status).toBe(401);
    expect(prisma.financial_reconciliation_issues.update).not.toHaveBeenCalled();
  });

  it("403 for an OWNER, before any mutation", async () => {
    mockSession.mockResolvedValue(OWNER);
    const res = await patchIssue(patchReq({ status: "RESOLVED" }), patchCtx());
    expect(res.status).toBe(403);
    expect(prisma.financial_reconciliation_issues.findUnique).not.toHaveBeenCalled();
    expect(prisma.financial_reconciliation_issues.update).not.toHaveBeenCalled();
  });

  it("200 for an ADMIN and records the admin as actor", async () => {
    mockSession.mockResolvedValue(ADMIN);
    const res = await patchIssue(patchReq({ status: "RESOLVED", notes: "done" }), patchCtx());
    expect(res.status).toBe(200);
    expect(prisma.financial_reconciliation_issues.update.mock.calls[0][0].data.resolved_by).toBe(ADMIN.sub);
  });
});

describe("POST scan", () => {
  it("401 without a session", async () => {
    mockSession.mockResolvedValue(null);
    expect((await scan(scanReq())).status).toBe(401);
    expect(recon.detectAll).not.toHaveBeenCalled();
  });

  it("403 for an OWNER, before any scan runs", async () => {
    mockSession.mockResolvedValue(OWNER);
    const res = await scan(scanReq({ persist: true }));
    expect(res.status).toBe(403);
    expect(recon.detectAll).not.toHaveBeenCalled();
    expect(recon.persistIssues).not.toHaveBeenCalled();
  });

  it("200 for an ADMIN", async () => {
    mockSession.mockResolvedValue(ADMIN);
    const res = await scan(scanReq());
    expect(res.status).toBe(200);
    expect(recon.detectAll).toHaveBeenCalledTimes(1);
  });
});
