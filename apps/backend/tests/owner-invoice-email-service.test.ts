/**
 * `ownerInvoiceEmailService` — the "invoice emailed to Owner" step. Verifies
 * the best-effort guarantee the rest of the owner-payment flow depends on:
 * this function never throws, and always records what happened on the
 * invoice row (`emailed_at` / `email_failed_at`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const prisma: any = {
    owner_invoices: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
  };
  return { prisma };
});

const { sendOwnerPaymentInvoiceMock } = vi.hoisted(() => ({
  sendOwnerPaymentInvoiceMock: vi.fn(async () => ({})),
}));
vi.mock("@/lib/services/email-service", () => ({
  EmailService: { sendOwnerPaymentInvoice: sendOwnerPaymentInvoiceMock },
}));

const { getDocumentBytesMock } = vi.hoisted(() => ({
  getDocumentBytesMock: vi.fn(async () => ({ bytes: Buffer.from("pdf-bytes"), fileName: "invoice.pdf" })),
}));
vi.mock("@/src/services/owner-billing/owner-invoice-document-service", () => ({
  ownerInvoiceDocumentService: { getDocumentBytes: getDocumentBytesMock },
}));

import { prisma } from "@/lib/db";
import { ownerInvoiceEmailService } from "@/src/services/owner-billing/owner-invoice-email-service";

const db = prisma as any;

const INVOICE_BASE = {
  id: "invoice-1",
  invoice_number: "STY-2026-AAAAAAAA",
  description: "Tenant onboarding cost",
  amount_paise: 50000,
  tax_paise: 0,
  payment_method: "CASH",
  issued_at: new Date("2026-09-20T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  sendOwnerPaymentInvoiceMock.mockResolvedValue({});
  getDocumentBytesMock.mockResolvedValue({ bytes: Buffer.from("pdf-bytes"), fileName: "invoice.pdf" });
});

describe("sendOwnerInvoiceEmail", () => {
  it("sends the email and marks emailed_at when the owner has an email on file", async () => {
    db.owner_invoices.findUnique.mockResolvedValue({
      ...INVOICE_BASE,
      profile: { name: "Ravi Owner", email: "ravi@example.com", owner_billing_profile: null },
    });

    const result = await ownerInvoiceEmailService.sendOwnerInvoiceEmail("invoice-1");

    expect(result.sent).toBe(true);
    expect(sendOwnerPaymentInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: "ravi@example.com", invoiceNumber: "STY-2026-AAAAAAAA" }),
    );
    expect(db.owner_invoices.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ emailed_at: expect.any(Date), email_failed_at: null }) }),
    );
  });

  it("prefers the owner_billing_profile email/name when present", async () => {
    db.owner_invoices.findUnique.mockResolvedValue({
      ...INVOICE_BASE,
      profile: {
        name: "Ravi Owner",
        email: "ravi@example.com",
        owner_billing_profile: { billing_name: "Ravi Hostels Pvt Ltd", billing_email: "billing@ravihostels.com" },
      },
    });

    await ownerInvoiceEmailService.sendOwnerInvoiceEmail("invoice-1");

    expect(sendOwnerPaymentInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: "billing@ravihostels.com", ownerName: "Ravi Hostels Pvt Ltd" }),
    );
  });

  it("does not send and marks email_failed_at when the owner has no email on file", async () => {
    db.owner_invoices.findUnique.mockResolvedValue({
      ...INVOICE_BASE,
      profile: { name: "Ravi Owner", email: "", owner_billing_profile: null },
    });

    const result = await ownerInvoiceEmailService.sendOwnerInvoiceEmail("invoice-1");

    expect(result).toEqual({ sent: false, reason: "NO_EMAIL_ON_FILE" });
    expect(sendOwnerPaymentInvoiceMock).not.toHaveBeenCalled();
    expect(db.owner_invoices.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email_failed_at: expect.any(Date) }) }),
    );
  });

  it("never throws when the email provider fails — marks email_failed_at instead", async () => {
    db.owner_invoices.findUnique.mockResolvedValue({
      ...INVOICE_BASE,
      profile: { name: "Ravi Owner", email: "ravi@example.com", owner_billing_profile: null },
    });
    sendOwnerPaymentInvoiceMock.mockRejectedValue(new Error("Resend is down"));

    const result = await ownerInvoiceEmailService.sendOwnerInvoiceEmail("invoice-1");

    expect(result).toEqual({ sent: false, reason: "SEND_FAILED" });
    expect(db.owner_invoices.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email_failed_at: expect.any(Date) }) }),
    );
  });

  it("never throws when the PDF cannot be generated", async () => {
    db.owner_invoices.findUnique.mockResolvedValue({
      ...INVOICE_BASE,
      profile: { name: "Ravi Owner", email: "ravi@example.com", owner_billing_profile: null },
    });
    getDocumentBytesMock.mockRejectedValue(new Error("ImageKit unreachable"));

    const result = await ownerInvoiceEmailService.sendOwnerInvoiceEmail("invoice-1");

    expect(result).toEqual({ sent: false, reason: "SEND_FAILED" });
  });
});
