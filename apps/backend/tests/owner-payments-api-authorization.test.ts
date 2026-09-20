/**
 * Route-level authorization for the generic owner-payment endpoints.
 * `x-auth-mode: legacy` headers resolve a session straight from headers (no
 * DB), matching tests/admin-add-owner.test.ts's convention — only the
 * MANAGER-permission lookup (`manager_profiles`) needs a DB mock. The
 * business logic itself (`ownerPaymentService.createPayment`) is mocked out
 * here — it is covered independently by tests/owner-payment-service.test.ts —
 * so these tests isolate "who is allowed to call this route at all".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => {
  const prisma: any = {
    manager_profiles: { findUnique: vi.fn() },
    owner_invoices: { findUnique: vi.fn() },
  };
  return { prisma };
});

const { createPaymentMock } = vi.hoisted(() => ({
  createPaymentMock: vi.fn(async () => ({
    payment: { id: "payment-1", amount_paise: 50000, payment_method: "CASH", description: "Tenant onboarding cost", status: "RECORDED", created_at: new Date() },
    invoice: { id: "invoice-1", invoice_number: "STY-2026-AAAAAAAA", amount_paise: 50000 },
    alreadyExisted: false,
  })),
}));
vi.mock("@/src/services/owner-billing/owner-payment-service", () => ({
  ownerPaymentService: { createPayment: createPaymentMock, listForOwner: vi.fn(async () => []) },
}));

const { getDocumentBytesMock } = vi.hoisted(() => ({
  getDocumentBytesMock: vi.fn(async () => ({ bytes: Buffer.from("pdf"), fileName: "invoice.pdf" })),
}));
vi.mock("@/src/services/owner-billing/owner-invoice-document-service", () => ({
  ownerInvoiceDocumentService: { getDocumentBytes: getDocumentBytesMock },
}));

const { retryOwnerInvoiceWhatsAppMock } = vi.hoisted(() => ({
  retryOwnerInvoiceWhatsAppMock: vi.fn(async () => ({ sent: true, messageId: "wamid.abc123" })),
}));
vi.mock("@/src/services/owner-billing/owner-invoice-whatsapp-service", () => ({
  ownerInvoiceWhatsAppService: { retryOwnerInvoiceWhatsApp: retryOwnerInvoiceWhatsAppMock },
}));

const { activityLogMock } = vi.hoisted(() => ({ activityLogMock: vi.fn(async () => undefined) }));
vi.mock("@/lib/services/activity.service", () => ({ activityService: { log: activityLogMock } }));

import { prisma } from "@/lib/db";
import { POST as recordOwnerPayment } from "@/app/api/platform-admin/owners/[id]/payments/route";
import { GET as getOwnerInvoice } from "@/app/api/owner/payments/invoices/[id]/route";
import { POST as resendWhatsApp } from "@/app/api/platform-admin/owner-invoices/[id]/resend-whatsapp/route";

const db = prisma as any;

const OWNER_ID = "owner-1111-1111-1111-111111111111";
const OTHER_OWNER_ID = "owner-2222-2222-2222-222222222222";
const ADMIN_ID = "admin-9999-9999-9999-999999999999";
const MANAGER_ID = "manager-8888-8888-8888-888888888888";

function req(url: string, headers: Record<string, string>, body?: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: body ? "POST" : "GET",
    headers: { "x-auth-mode": "legacy", "content-type": "application/json", ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  } as any);
}

const paymentBody = { amount_paise: 50000, payment_method: "CASH", description: "Tenant onboarding cost" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/platform-admin/owners/[id]/payments — authorization", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await recordOwnerPayment(
      new NextRequest(`http://localhost/api/platform-admin/owners/${OWNER_ID}/payments`, {
        method: "POST",
        body: JSON.stringify(paymentBody),
      } as any),
      { params: Promise.resolve({ id: OWNER_ID }) },
    );
    expect(res.status).toBe(403);
    expect(createPaymentMock).not.toHaveBeenCalled();
  });

  it("rejects an OWNER-role session", async () => {
    const res = await recordOwnerPayment(
      req(`http://localhost/api/platform-admin/owners/${OWNER_ID}/payments`, { "x-user-id": OWNER_ID, "x-user-role": "OWNER" }, paymentBody),
      { params: Promise.resolve({ id: OWNER_ID }) },
    );
    expect(res.status).toBe(403);
    expect(createPaymentMock).not.toHaveBeenCalled();
  });

  it("allows an ADMIN session and passes the path owner id (never a body one)", async () => {
    const res = await recordOwnerPayment(
      req(
        `http://localhost/api/platform-admin/owners/${OWNER_ID}/payments`,
        { "x-user-id": ADMIN_ID, "x-user-role": "ADMIN" },
        { ...paymentBody, owner_id: OTHER_OWNER_ID }, // even if a caller tried to sneak this in
      ),
      { params: Promise.resolve({ id: OWNER_ID }) },
    );
    expect(res.status).toBe(201);
    expect(createPaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ADMIN_ID, input: expect.objectContaining({ ownerId: OWNER_ID }) }),
    );
  });

  it("rejects a MANAGER with no manager_profiles row", async () => {
    db.manager_profiles.findUnique.mockResolvedValue(null);
    const res = await recordOwnerPayment(
      req(`http://localhost/api/platform-admin/owners/${OWNER_ID}/payments`, { "x-user-id": MANAGER_ID, "x-user-role": "MANAGER" }, paymentBody),
      { params: Promise.resolve({ id: OWNER_ID }) },
    );
    expect(res.status).toBe(403);
    expect(createPaymentMock).not.toHaveBeenCalled();
  });

  it("rejects a MANAGER without the MANAGE_SUBSCRIPTIONS permission", async () => {
    db.manager_profiles.findUnique.mockResolvedValue({
      id: "mgr-row-1",
      profile_id: MANAGER_ID,
      permissions: [{ permission: "MANAGE_LEADS" }],
      hostel_assignments: [],
    });
    const res = await recordOwnerPayment(
      req(`http://localhost/api/platform-admin/owners/${OWNER_ID}/payments`, { "x-user-id": MANAGER_ID, "x-user-role": "MANAGER" }, paymentBody),
      { params: Promise.resolve({ id: OWNER_ID }) },
    );
    expect(res.status).toBe(403);
    expect(createPaymentMock).not.toHaveBeenCalled();
  });

  it("allows a MANAGER holding the MANAGE_SUBSCRIPTIONS permission", async () => {
    db.manager_profiles.findUnique.mockResolvedValue({
      id: "mgr-row-1",
      profile_id: MANAGER_ID,
      permissions: [{ permission: "MANAGE_SUBSCRIPTIONS" }],
      hostel_assignments: [],
    });
    const res = await recordOwnerPayment(
      req(`http://localhost/api/platform-admin/owners/${OWNER_ID}/payments`, { "x-user-id": MANAGER_ID, "x-user-role": "MANAGER" }, paymentBody),
      { params: Promise.resolve({ id: OWNER_ID }) },
    );
    expect(res.status).toBe(201);
    expect(createPaymentMock).toHaveBeenCalledWith(expect.objectContaining({ actorId: MANAGER_ID }));
  });
});

describe("GET /api/owner/payments/invoices/[id] — cross-owner access", () => {
  it("404s when the invoice belongs to a different owner (never leaks a 403 that would confirm existence)", async () => {
    db.owner_invoices.findUnique.mockResolvedValue({ id: "invoice-1", owner_id: OTHER_OWNER_ID });

    const res = await getOwnerInvoice(
      req(`http://localhost/api/owner/payments/invoices/invoice-1`, { "x-user-id": OWNER_ID, "x-user-role": "OWNER" }),
      { params: Promise.resolve({ id: "invoice-1" }) },
    );

    expect(res.status).toBe(404);
    expect(getDocumentBytesMock).not.toHaveBeenCalled();
  });

  it("serves the PDF when the owner owns the invoice", async () => {
    db.owner_invoices.findUnique.mockResolvedValue({ id: "invoice-1", owner_id: OWNER_ID });

    const res = await getOwnerInvoice(
      req(`http://localhost/api/owner/payments/invoices/invoice-1`, { "x-user-id": OWNER_ID, "x-user-role": "OWNER" }),
      { params: Promise.resolve({ id: "invoice-1" }) },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(getDocumentBytesMock).toHaveBeenCalledWith("invoice-1");
  });

  it("rejects a non-owner session outright", async () => {
    const res = await getOwnerInvoice(
      req(`http://localhost/api/owner/payments/invoices/invoice-1`, { "x-user-id": ADMIN_ID, "x-user-role": "ADMIN" }),
      { params: Promise.resolve({ id: "invoice-1" }) },
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/platform-admin/owner-invoices/[id]/resend-whatsapp — authorization + retry", () => {
  beforeEach(() => {
    db.owner_invoices.findUnique.mockResolvedValue({ id: "invoice-1", owner_id: OWNER_ID, invoice_number: "STY-2026-AAAAAAAA" });
  });

  it("rejects an unauthenticated request", async () => {
    const res = await resendWhatsApp(
      new NextRequest(`http://localhost/api/platform-admin/owner-invoices/invoice-1/resend-whatsapp`, { method: "POST" } as any),
      { params: Promise.resolve({ id: "invoice-1" }) },
    );
    expect(res.status).toBe(403);
    expect(retryOwnerInvoiceWhatsAppMock).not.toHaveBeenCalled();
  });

  it("rejects an OWNER-role session", async () => {
    const res = await resendWhatsApp(
      req(`http://localhost/api/platform-admin/owner-invoices/invoice-1/resend-whatsapp`, { "x-user-id": OWNER_ID, "x-user-role": "OWNER" }, {}),
      { params: Promise.resolve({ id: "invoice-1" }) },
    );
    expect(res.status).toBe(403);
    expect(retryOwnerInvoiceWhatsAppMock).not.toHaveBeenCalled();
  });

  it("allows an ADMIN session, retries the SAME invoice, and audits the outcome", async () => {
    const res = await resendWhatsApp(
      req(`http://localhost/api/platform-admin/owner-invoices/invoice-1/resend-whatsapp`, { "x-user-id": ADMIN_ID, "x-user-role": "ADMIN" }, {}),
      { params: Promise.resolve({ id: "invoice-1" }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(true);
    expect(retryOwnerInvoiceWhatsAppMock).toHaveBeenCalledWith("invoice-1");
    const actionTypes = activityLogMock.mock.calls.map((c) => c[0].actionType);
    expect(actionTypes).toContain("OWNER_INVOICE_WHATSAPP_SENT");
  });

  it("404s for a missing invoice", async () => {
    db.owner_invoices.findUnique.mockResolvedValue(null);
    const res = await resendWhatsApp(
      req(`http://localhost/api/platform-admin/owner-invoices/missing/resend-whatsapp`, { "x-user-id": ADMIN_ID, "x-user-role": "ADMIN" }, {}),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(res.status).toBe(404);
  });
});
