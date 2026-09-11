/**
 * Phase 6.9 — route-handler-level HTTP tests for owner subscription billing.
 *
 * SCOPE / LIMITATION (documented per the Phase 6.9 brief): this repo has no
 * existing pattern for full end-to-end HTTP tests against a live server with
 * a real Supabase-issued JWT (`middleware.ts` verifies those against
 * Supabase's JWKS endpoint using an asymmetric key this test process cannot
 * sign for, and no test user / real sign-in harness exists anywhere in the
 * suite). Building that from scratch — a live `next start` process, a real
 * Supabase auth handshake, cookie/session management — would be new
 * infrastructure well beyond this phase's scope, so it was not fabricated.
 *
 * What IS tested here, and is genuine: the actual exported route handler
 * functions (`GET`/`POST`/`DELETE` from `app/api/...`) are imported and
 * invoked with a real `NextRequest`, carrying the `x-auth-mode: legacy`
 * trust headers that `getSession()` reads directly (`lib/auth.ts`) — the
 * same headers `middleware.ts` injects after verifying a real session, for
 * the legacy (pre-Supabase-migration) auth mode that remains a live,
 * supported code path. This exercises the real route → `resolveOwnerId`/
 * `requireAdmin` → service call → response-shaping chain, including real
 * HTTP status codes and JSON shape — everything except middleware's own JWT
 * verification, which was instead verified by reading `middleware.ts`
 * directly (`stripIdentityHeaders` unconditionally deletes any
 * client-supplied identity header before re-setting trusted ones from a
 * verified token — a client cannot forge these headers against the real
 * server; see docs/obsidian/Decisions.md ADR-174 Phase 6.9 note).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_OWNER_ID = "22222222-2222-2222-2222-222222222222";
const ADMIN_ID = "99999999-9999-9999-9999-999999999999";

vi.mock("@/lib/db", () => {
  const prisma: any = {
    owner_subscriptions: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn(async () => 0), create: vi.fn() },
    subscription_plans: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
    subscription_payments: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []), findUnique: vi.fn(), updateMany: vi.fn() },
    subscription_invoices: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
    profile: { findFirst: vi.fn() },
    tenants: { count: vi.fn(async () => 0) },
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (cb: any) => cb(prisma)),
  };
  return { prisma };
});
const { eventLogMock } = vi.hoisted(() => ({ eventLogMock: { log: vi.fn(async () => undefined) } }));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: eventLogMock }));
vi.mock("@/src/services/platform-billing/subscription-invoice-document-service", () => ({
  subscriptionInvoiceDocumentService: {
    getDocumentBytes: vi.fn(async () => ({ bytes: Buffer.from("%PDF-1.7 fake"), fileName: "SUB-2026-TEST.pdf" })),
  },
}));

import { prisma } from "@/lib/db";
const db = prisma as any;

function ownerReq(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, {
    ...init,
    headers: {
      "x-auth-mode": "legacy",
      "x-user-id": OWNER_ID,
      "x-user-role": "OWNER",
      "x-user-email": "owner@test.local",
      ...(init?.headers as Record<string, string> | undefined),
    },
  } as any);
}
function adminReq(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, {
    ...init,
    headers: {
      "x-auth-mode": "legacy",
      "x-user-id": ADMIN_ID,
      "x-user-role": "ADMIN",
      "x-user-email": "admin@test.local",
      ...(init?.headers as Record<string, string> | undefined),
    },
  } as any);
}
function anonReq(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, init as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (cb: any) => cb(db));
});

describe("GET /api/owner/subscription — owner-scoped, session-derived identity only", () => {
  it("returns the caller's own subscription (200) using ONLY the session identity", async () => {
    const { GET } = await import("@/app/api/owner/subscription/route");
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "sub-1", owner_id: OWNER_ID, plan_id: "plan-1", status: "ACTIVE", extra_beds: 0,
      pending_plan_id: null, trial_ends_at: null, current_period_start: new Date(), current_period_end: new Date(),
      next_renewal_at: new Date(), started_at: new Date(), cancelled_at: null,
    });
    db.subscription_plans.findUnique.mockResolvedValue({ id: "plan-1", code: "STARTER", name: "Starter", price_paise: 149900, currency: "INR", capacity_max: 60, included_beds: 50, max_extra_beds: 10, extra_bed_price_paise: 1000 });
    db.tenants.count.mockResolvedValue(0);

    const res = await GET(ownerReq("http://test.local/api/owner/subscription"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.subscription.id).toBe("sub-1");
    // The route never accepted an ownerId from the request — confirm the DB
    // lookup was scoped to the SESSION's owner id, not anything client-supplied.
    expect(db.owner_subscriptions.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { owner_id: OWNER_ID } }));
  });

  it("an unauthenticated request (no session headers) is rejected, never defaults to a guessable identity", async () => {
    const { GET } = await import("@/app/api/owner/subscription/route");
    const res = await anonReq("http://test.local/api/owner/subscription").clone();
    const response = await GET(res as any);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("error responses never leak a stack trace or raw Prisma error", async () => {
    const { GET } = await import("@/app/api/owner/subscription/route");
    db.owner_subscriptions.findUnique.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432 at PrismaClient.\n    at /app/node_modules/@prisma/client/runtime/library.js:123:45"));
    const res = await GET(ownerReq("http://test.local/api/owner/subscription"));
    expect(res.status).toBe(500);
    const body = await res.json();
    const blob = JSON.stringify(body);
    expect(blob).not.toMatch(/ECONNREFUSED|node_modules|at .*\(|library\.js/);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});

describe("GET /api/owner/subscription/invoices/[id] — cross-owner access returns 404, never confirms existence", () => {
  it("the owner CAN download their own invoice — real PDF bytes, correct headers, no document_url in the response", async () => {
    const { GET } = await import("@/app/api/owner/subscription/invoices/[id]/route");
    db.subscription_invoices.findUnique.mockResolvedValue({ id: "inv-1", owner_id: OWNER_ID });

    const res = await GET(ownerReq("http://test.local/api/owner/subscription/invoices/inv-1"), { params: Promise.resolve({ id: "inv-1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("SUB-2026-TEST.pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("a DIFFERENT owner requesting the same invoice id gets 404, not 403 (no existence disclosure)", async () => {
    const { GET } = await import("@/app/api/owner/subscription/invoices/[id]/route");
    db.subscription_invoices.findUnique.mockResolvedValue({ id: "inv-1", owner_id: OTHER_OWNER_ID });

    const res = await GET(ownerReq("http://test.local/api/owner/subscription/invoices/inv-1"), { params: Promise.resolve({ id: "inv-1" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("a genuinely nonexistent invoice id ALSO gets 404 — indistinguishable from the cross-owner case", async () => {
    const { GET } = await import("@/app/api/owner/subscription/invoices/[id]/route");
    db.subscription_invoices.findUnique.mockResolvedValue(null);

    const res = await GET(ownerReq("http://test.local/api/owner/subscription/invoices/does-not-exist"), { params: Promise.resolve({ id: "does-not-exist" }) });
    expect(res.status).toBe(404);
  });
});

describe("Admin routes — non-admin (or anonymous) callers are rejected before touching the service layer", () => {
  it("POST /api/platform-admin/subscription-payments/[id]/approve: an OWNER-role session is forbidden (403), payment untouched", async () => {
    const { POST } = await import("@/app/api/platform-admin/subscription-payments/[id]/approve/route");
    const res = await POST(ownerReq("http://test.local/api/platform-admin/subscription-payments/pay-1/approve", { method: "POST" }), {
      params: Promise.resolve({ id: "pay-1" }),
    });
    expect(res.status).toBe(403);
    expect(db.subscription_payments.updateMany).not.toHaveBeenCalled();
  });

  it("an ADMIN-role session IS allowed through the gate (reaches the service, which then 404s on the fake id — proving the gate itself passed)", async () => {
    const { POST } = await import("@/app/api/platform-admin/subscription-payments/[id]/approve/route");
    db.subscription_payments.findUnique.mockResolvedValue(null);
    const res = await POST(adminReq("http://test.local/api/platform-admin/subscription-payments/pay-missing/approve", { method: "POST" }), {
      params: Promise.resolve({ id: "pay-missing" }),
    });
    expect(res.status).toBe(404); // NOT 403 — the admin gate passed; the service's own not-found fired instead
  });

  it("GET /api/platform-admin/subscription-invoices/[id]: a non-admin is forbidden", async () => {
    const { GET } = await import("@/app/api/platform-admin/subscription-invoices/[id]/route");
    const res = await GET(ownerReq("http://test.local/api/platform-admin/subscription-invoices/inv-1"), { params: Promise.resolve({ id: "inv-1" }) });
    expect(res.status).toBe(403);
  });

  it("GET /api/platform-admin/subscriptions: a non-admin is forbidden", async () => {
    const { GET } = await import("@/app/api/platform-admin/subscriptions/route");
    const res = await GET(ownerReq("http://test.local/api/platform-admin/subscriptions"));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/owner/subscription/downgrade — owner-scoped, cannot target another owner", () => {
  it("schedules against the SESSION owner's subscription, ignoring any owner-identifying field in the body", async () => {
    const { POST } = await import("@/app/api/owner/subscription/downgrade/route");
    db.owner_subscriptions.findUnique.mockResolvedValue({
      id: "sub-1", owner_id: OWNER_ID, plan_id: "plan-growth", status: "ACTIVE", extra_beds: 0, pending_plan_id: null,
    });
    db.subscription_plans.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === "plan-growth") return { id: "plan-growth", code: "GROWTH", name: "Growth", price_paise: 249900, is_active: true };
      if (where.id === "plan-starter") return { id: "plan-starter", code: "STARTER", name: "Starter", price_paise: 149900, is_active: true };
      return null;
    });
    db.owner_subscriptions.update.mockImplementation(async ({ data }: any) => ({ id: "sub-1", ...data }));

    // Body maliciously tries to smuggle a different owner_id — the route
    // never reads it; resolveOwnerId(session) is the only source.
    const res = await POST(
      ownerReq("http://test.local/api/owner/subscription/downgrade", {
        method: "POST",
        body: JSON.stringify({ plan_id: "plan-starter", owner_id: OTHER_OWNER_ID }),
      }),
    );
    expect(res.status).toBe(200);
    expect(db.owner_subscriptions.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { owner_id: OWNER_ID } }));
  });
});
