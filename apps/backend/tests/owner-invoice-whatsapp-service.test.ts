/**
 * `ownerInvoiceWhatsAppService` — mandatory WhatsApp invoice-PDF delivery
 * (document-template message, not freeform text). Verifies it sends the
 * actual document through the existing `whatsAppTemplateDeliveryService`
 * abstraction, selects the correct verified owner identity, never throws,
 * and that a retry sends the SAME invoice under a fresh idempotency key
 * (never a new payment/invoice).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const prisma: any = {
    owner_whatsapp_identities: { findFirst: vi.fn() },
    owner_invoices: { findUnique: vi.fn() },
    whatsapp_logs: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) },
  };
  return { prisma };
});

const { sendMock, verifyTemplateHealthMock } = vi.hoisted(() => ({
  sendMock: vi.fn(async () => ({ sent: true, skipped: false, providerMessageId: "wamid.abc123", idempotencyKey: "k" })),
  verifyTemplateHealthMock: vi.fn(async () => ({ exists: true, status: "APPROVED" })),
}));
vi.mock("@/lib/services/notifications/whatsapp-template-delivery", () => ({
  whatsAppTemplateDeliveryService: { send: sendMock, verifyTemplateHealth: verifyTemplateHealthMock },
}));

const { generateDocumentMock } = vi.hoisted(() => ({
  generateDocumentMock: vi.fn(async () => ({ bytes: Buffer.from("pdf"), documentUrl: "https://ik.imagekit.io/dummy/invoice.pdf" })),
}));
vi.mock("@/src/services/owner-billing/owner-invoice-document-service", () => ({
  ownerInvoiceDocumentService: { generateDocument: generateDocumentMock },
}));

import { prisma } from "@/lib/db";
import { ownerInvoiceWhatsAppService } from "@/src/services/owner-billing/owner-invoice-whatsapp-service";
import { OwnerBillingError } from "@/src/services/owner-billing/owner-billing-errors";

const db = prisma as any;

const INVOICE_BASE = {
  id: "invoice-1",
  owner_id: "owner-1",
  invoice_number: "STY-2026-AAAAAAAA",
  description: "Tenant onboarding cost",
  amount_paise: 50000,
  tax_paise: 0,
  document_url: null as string | null,
  profile: { name: "Ravi Owner", owner_billing_profile: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid.abc123", idempotencyKey: "k" });
  verifyTemplateHealthMock.mockResolvedValue({ exists: true, status: "APPROVED" });
  generateDocumentMock.mockResolvedValue({ bytes: Buffer.from("pdf"), documentUrl: "https://ik.imagekit.io/dummy/invoice.pdf" });
  db.whatsapp_logs.count.mockResolvedValue(0);
  db.whatsapp_logs.findFirst.mockResolvedValue(null);
});

describe("sendOwnerInvoiceWhatsAppDocument", () => {
  it("sends the invoice PDF as a document-template message to the verified owner number", async () => {
    db.owner_invoices.findUnique.mockResolvedValue({ ...INVOICE_BASE, document_url: "https://ik.imagekit.io/dummy/invoice.pdf" });
    db.owner_whatsapp_identities.findFirst.mockResolvedValue({ phone_number: "+919876543210" });

    const result = await ownerInvoiceWhatsAppService.sendOwnerInvoiceWhatsAppDocument("invoice-1");

    expect(result).toEqual({ sent: true, messageId: "wamid.abc123" });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.phone).toBe("+919876543210");
    expect(call.headerDocument).toEqual({ link: "https://ik.imagekit.io/dummy/invoice.pdf", filename: "Invoice_STY-2026-AAAAAAAA.pdf" });
    expect(call.bodyParameters).toEqual(["Ravi Owner", "₹500.00", "Tenant onboarding cost", "STY-2026-AAAAAAAA"]);
    // Never re-renders the PDF when document_url is already on the row.
    expect(generateDocumentMock).not.toHaveBeenCalled();
  });

  it("selects the correct owner's WhatsApp identity, not any other owner's", async () => {
    db.owner_invoices.findUnique.mockResolvedValue({ ...INVOICE_BASE, owner_id: "owner-42", document_url: "https://x/invoice.pdf" });
    db.owner_whatsapp_identities.findFirst.mockResolvedValue({ phone_number: "+911111111111" });

    await ownerInvoiceWhatsAppService.sendOwnerInvoiceWhatsAppDocument("invoice-1");

    expect(db.owner_whatsapp_identities.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ owner_id: "owner-42", is_verified: true }) }),
    );
  });

  it("generates the document when the invoice has no document_url yet", async () => {
    db.owner_invoices.findUnique.mockResolvedValue({ ...INVOICE_BASE, document_url: null });
    db.owner_whatsapp_identities.findFirst.mockResolvedValue({ phone_number: "+919876543210" });

    await ownerInvoiceWhatsAppService.sendOwnerInvoiceWhatsAppDocument("invoice-1");

    expect(generateDocumentMock).toHaveBeenCalledWith("invoice-1");
  });

  it("does not send when the owner has no verified WhatsApp connection", async () => {
    db.owner_invoices.findUnique.mockResolvedValue({ ...INVOICE_BASE, document_url: "https://x/invoice.pdf" });
    db.owner_whatsapp_identities.findFirst.mockResolvedValue(null);

    const result = await ownerInvoiceWhatsAppService.sendOwnerInvoiceWhatsAppDocument("invoice-1");

    expect(result).toEqual({ sent: false, reason: "NO_VERIFIED_WHATSAPP" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("never sends a freeform text — every send goes through the document-template call", async () => {
    db.owner_invoices.findUnique.mockResolvedValue({ ...INVOICE_BASE, document_url: "https://x/invoice.pdf" });
    db.owner_whatsapp_identities.findFirst.mockResolvedValue({ phone_number: "+919876543210" });

    await ownerInvoiceWhatsAppService.sendOwnerInvoiceWhatsAppDocument("invoice-1");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.templateName).toBeTruthy();
    expect(call.headerDocument?.link).toBeTruthy();
  });

  it("reports TEMPLATE_NOT_CONFIGURED and never sends when the template is missing/not approved (no freeform fallback)", async () => {
    db.owner_invoices.findUnique.mockResolvedValue({ ...INVOICE_BASE, document_url: "https://x/invoice.pdf" });
    db.owner_whatsapp_identities.findFirst.mockResolvedValue({ phone_number: "+919876543210" });
    verifyTemplateHealthMock.mockResolvedValue({ exists: false });

    const result = await ownerInvoiceWhatsAppService.sendOwnerInvoiceWhatsAppDocument("invoice-1");

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("TEMPLATE_NOT_CONFIGURED");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("reports TEMPLATE_NOT_CONFIGURED when the template exists but is not APPROVED", async () => {
    db.owner_invoices.findUnique.mockResolvedValue({ ...INVOICE_BASE, document_url: "https://x/invoice.pdf" });
    db.owner_whatsapp_identities.findFirst.mockResolvedValue({ phone_number: "+919876543210" });
    verifyTemplateHealthMock.mockResolvedValue({ exists: true, status: "PENDING" });

    const result = await ownerInvoiceWhatsAppService.sendOwnerInvoiceWhatsAppDocument("invoice-1");

    expect(result.reason).toBe("TEMPLATE_NOT_CONFIGURED");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("never throws when the provider send fails — reports SEND_FAILED", async () => {
    db.owner_invoices.findUnique.mockResolvedValue({ ...INVOICE_BASE, document_url: "https://x/invoice.pdf" });
    db.owner_whatsapp_identities.findFirst.mockResolvedValue({ phone_number: "+919876543210" });
    sendMock.mockRejectedValue(new Error("Meta API error"));

    const result = await ownerInvoiceWhatsAppService.sendOwnerInvoiceWhatsAppDocument("invoice-1");

    expect(result).toEqual({ sent: false, reason: "SEND_FAILED", detail: "Meta API error" });
  });

  it("returns INVOICE_NOT_FOUND for a missing invoice, never throws", async () => {
    db.owner_invoices.findUnique.mockResolvedValue(null);
    const result = await ownerInvoiceWhatsAppService.sendOwnerInvoiceWhatsAppDocument("missing");
    expect(result).toEqual({ sent: false, reason: "INVOICE_NOT_FOUND" });
  });
});

describe("idempotency / retry", () => {
  it("uses a fresh, incrementing idempotency key per attempt (never reuses one across retries)", async () => {
    db.owner_invoices.findUnique.mockResolvedValue({ ...INVOICE_BASE, document_url: "https://x/invoice.pdf" });
    db.owner_whatsapp_identities.findFirst.mockResolvedValue({ phone_number: "+919876543210" });

    db.whatsapp_logs.count.mockResolvedValueOnce(0);
    await ownerInvoiceWhatsAppService.sendOwnerInvoiceWhatsAppDocument("invoice-1");
    expect(sendMock.mock.calls[0][0].idempotencyKey).toBe("owner-invoice-whatsapp:invoice-1:1");

    db.whatsapp_logs.count.mockResolvedValueOnce(1);
    await ownerInvoiceWhatsAppService.sendOwnerInvoiceWhatsAppDocument("invoice-1");
    expect(sendMock.mock.calls[1][0].idempotencyKey).toBe("owner-invoice-whatsapp:invoice-1:2");
  });

  it("retryOwnerInvoiceWhatsApp sends the SAME invoice again — never creates a new payment or invoice", async () => {
    db.owner_invoices.findUnique.mockResolvedValue({ ...INVOICE_BASE, document_url: "https://x/invoice.pdf" });
    db.owner_whatsapp_identities.findFirst.mockResolvedValue({ phone_number: "+919876543210" });

    const result = await ownerInvoiceWhatsAppService.retryOwnerInvoiceWhatsApp("invoice-1");

    expect(result.sent).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(db.owner_invoices.findUnique).toHaveBeenCalled();
    // No payment/invoice-creation calls exist on this mocked prisma at all —
    // the only owner_invoices call is the lookup, confirming no new row is created.
  });

  it("retryOwnerInvoiceWhatsApp throws NOT_FOUND for a missing invoice (route maps this to 404)", async () => {
    db.owner_invoices.findUnique.mockResolvedValue(null);
    await expect(ownerInvoiceWhatsAppService.retryOwnerInvoiceWhatsApp("missing")).rejects.toSatisfy(
      (e: any) => e instanceof OwnerBillingError && e.code === "NOT_FOUND",
    );
  });
});

describe("getOwnerInvoiceWhatsAppStatus", () => {
  it("is PENDING when no attempt has ever been made", async () => {
    db.whatsapp_logs.findFirst.mockResolvedValue(null);
    const status = await ownerInvoiceWhatsAppService.getOwnerInvoiceWhatsAppStatus("invoice-1");
    expect(status.status).toBe("PENDING");
  });

  it("is SENT with the message id once delivered", async () => {
    db.whatsapp_logs.findFirst.mockResolvedValue({
      status: "SENT",
      created_at: new Date("2026-09-20T10:00:00Z"),
      provider_message_id: "wamid.abc123",
      provider_error_message: null,
      attempt_count: 1,
    });
    const status = await ownerInvoiceWhatsAppService.getOwnerInvoiceWhatsAppStatus("invoice-1");
    expect(status).toEqual({
      status: "SENT",
      sentAt: new Date("2026-09-20T10:00:00Z"),
      messageId: "wamid.abc123",
      error: null,
      attempts: 1,
    });
  });

  it("is FAILED with the provider error surfaced for the admin", async () => {
    db.whatsapp_logs.findFirst.mockResolvedValue({
      status: "FAILED",
      created_at: new Date(),
      provider_message_id: null,
      provider_error_message: "Template not approved",
      attempt_count: 1,
    });
    const status = await ownerInvoiceWhatsAppService.getOwnerInvoiceWhatsAppStatus("invoice-1");
    expect(status.status).toBe("FAILED");
    expect(status.error).toBe("Template not approved");
  });
});
