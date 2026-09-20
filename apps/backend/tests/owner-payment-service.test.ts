/**
 * Generic owner-payment service (NOT subscription payments — see
 * src/services/owner-billing/owner-payment-service.ts). Mocked-Prisma unit
 * tests, same style as tests/subscription-billing-service.test.ts, so they
 * run without a live database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const prisma: any = {
    profile: { findFirst: vi.fn() },
    owner_payments: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(),
    },
    owner_invoices: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    // Present so a test can assert subscription billing is never touched by
    // this domain (business requirement: generic payments must never affect
    // an owner's subscription).
    owner_subscriptions: { update: vi.fn(), findUnique: vi.fn() },
    subscription_payments: { create: vi.fn() },
    $transaction: vi.fn(async (cb: any) => cb(prisma)),
  };
  return { prisma };
});

const { activityLogMock } = vi.hoisted(() => ({ activityLogMock: vi.fn(async () => undefined) }));
vi.mock("@/lib/services/activity.service", () => ({
  activityService: { log: activityLogMock },
}));

const { sendOwnerInvoiceEmailMock } = vi.hoisted(() => ({
  sendOwnerInvoiceEmailMock: vi.fn(async () => ({ sent: true })),
}));
vi.mock("@/src/services/owner-billing/owner-invoice-email-service", () => ({
  ownerInvoiceEmailService: { sendOwnerInvoiceEmail: sendOwnerInvoiceEmailMock },
}));

const { sendOwnerInvoiceWhatsAppDocumentMock } = vi.hoisted(() => ({
  sendOwnerInvoiceWhatsAppDocumentMock: vi.fn(async () => ({ sent: false, reason: "NO_VERIFIED_WHATSAPP" })),
}));
vi.mock("@/src/services/owner-billing/owner-invoice-whatsapp-service", () => ({
  ownerInvoiceWhatsAppService: { sendOwnerInvoiceWhatsAppDocument: sendOwnerInvoiceWhatsAppDocumentMock },
}));

import { prisma } from "@/lib/db";
import { ownerPaymentService } from "@/src/services/owner-billing/owner-payment-service";
import { isOwnerBillingError } from "@/src/services/owner-billing/owner-billing-errors";

const db = prisma as any;

const OWNER_ID = "owner-1111-1111-1111-111111111111";
const ADMIN_ID = "admin-9999-9999-9999-999999999999";

function wireOwnerFound() {
  db.profile.findFirst.mockResolvedValue({ id: OWNER_ID });
}

let paymentSeq = 0;
function wirePaymentCreate() {
  db.owner_payments.create.mockImplementation(async ({ data }: any) => ({
    id: `payment-${++paymentSeq}`,
    status: "RECORDED",
    created_at: new Date(),
    ...data,
  }));
}

function wireInvoiceCreate() {
  db.owner_invoices.create.mockImplementation(async ({ data }: any) => ({
    id: `invoice-${paymentSeq}`,
    issued_at: new Date(),
    ...data,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  paymentSeq = 0;
  db.$transaction.mockImplementation(async (cb: any) => cb(db));
  wireOwnerFound();
  wirePaymentCreate();
  wireInvoiceCreate();
  sendOwnerInvoiceEmailMock.mockResolvedValue({ sent: true });
  sendOwnerInvoiceWhatsAppDocumentMock.mockResolvedValue({ sent: false, reason: "NO_VERIFIED_WHATSAPP" });
});

const validInput = {
  ownerId: OWNER_ID,
  amountPaise: 50000,
  paymentMethod: "CASH",
  description: "Tenant onboarding cost",
};

describe("ownerPaymentService.createPayment — validation", () => {
  it("rejects a missing/invalid amount", async () => {
    await expect(
      ownerPaymentService.createPayment({ actorId: ADMIN_ID, input: { ...validInput, amountPaise: 0 } }),
    ).rejects.toSatisfy((e: any) => isOwnerBillingError(e) && e.code === "INVALID_PAYMENT");

    await expect(
      ownerPaymentService.createPayment({ actorId: ADMIN_ID, input: { ...validInput, amountPaise: -100 } }),
    ).rejects.toSatisfy((e: any) => isOwnerBillingError(e));

    await expect(
      ownerPaymentService.createPayment({ actorId: ADMIN_ID, input: { ...validInput, amountPaise: 99.5 } }),
    ).rejects.toSatisfy((e: any) => isOwnerBillingError(e));
  });

  it("rejects a missing description", async () => {
    await expect(
      ownerPaymentService.createPayment({ actorId: ADMIN_ID, input: { ...validInput, description: "   " } }),
    ).rejects.toSatisfy((e: any) => isOwnerBillingError(e) && e.code === "INVALID_PAYMENT");
  });

  it("rejects an unknown payment method", async () => {
    await expect(
      ownerPaymentService.createPayment({ actorId: ADMIN_ID, input: { ...validInput, paymentMethod: "GATEWAY" } }),
    ).rejects.toSatisfy((e: any) => isOwnerBillingError(e));
  });

  it("rejects a description over the max length", async () => {
    await expect(
      ownerPaymentService.createPayment({
        actorId: ADMIN_ID,
        input: { ...validInput, description: "x".repeat(241) },
      }),
    ).rejects.toSatisfy((e: any) => isOwnerBillingError(e));
  });

  it("rejects when the owner does not exist", async () => {
    db.profile.findFirst.mockResolvedValue(null);
    await expect(
      ownerPaymentService.createPayment({ actorId: ADMIN_ID, input: validInput }),
    ).rejects.toSatisfy((e: any) => isOwnerBillingError(e) && e.code === "NOT_FOUND");
  });
});

describe("ownerPaymentService.createPayment — happy path", () => {
  it("creates the payment and its invoice atomically", async () => {
    const { payment, invoice, alreadyExisted } = await ownerPaymentService.createPayment({
      actorId: ADMIN_ID,
      input: validInput,
    });

    expect(alreadyExisted).toBe(false);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.owner_payments.create).toHaveBeenCalledTimes(1);
    expect(db.owner_payments.create.mock.calls[0][0].data).toMatchObject({
      owner_id: OWNER_ID,
      amount_paise: 50000,
      payment_method: "CASH",
      description: "Tenant onboarding cost",
      created_by: ADMIN_ID,
    });

    expect(payment.amount_paise).toBe(50000);
    expect(invoice).toBeTruthy();
  });

  it("generates a unique invoice number and copies the description onto the invoice", async () => {
    const { invoice } = await ownerPaymentService.createPayment({ actorId: ADMIN_ID, input: validInput });
    expect(invoice.invoice_number).toMatch(/^STY-\d{4}-[A-F0-9]{8}$/);
    expect(invoice.description).toBe("Tenant onboarding cost");
    expect(invoice.amount_paise).toBe(50000);
  });

  it("audit-logs OWNER_PAYMENT_CREATED and OWNER_INVOICE_CREATED via the existing activity_logs system", async () => {
    await ownerPaymentService.createPayment({ actorId: ADMIN_ID, input: validInput });

    const actionTypes = activityLogMock.mock.calls.map((c) => c[0].actionType);
    expect(actionTypes).toContain("OWNER_PAYMENT_CREATED");
    expect(actionTypes).toContain("OWNER_INVOICE_CREATED");
  });

  it("triggers the invoice email and logs OWNER_INVOICE_SENT when it succeeds", async () => {
    await ownerPaymentService.createPayment({ actorId: ADMIN_ID, input: validInput });

    expect(sendOwnerInvoiceEmailMock).toHaveBeenCalledTimes(1);
    const actionTypes = activityLogMock.mock.calls.map((c) => c[0].actionType);
    expect(actionTypes).toContain("OWNER_INVOICE_SENT");
  });

  it("never touches subscription billing tables", async () => {
    await ownerPaymentService.createPayment({ actorId: ADMIN_ID, input: validInput });
    expect(db.owner_subscriptions.update).not.toHaveBeenCalled();
    expect(db.subscription_payments.create).not.toHaveBeenCalled();
  });
});

describe("ownerPaymentService.createPayment — email is best-effort", () => {
  it("a missing owner email does not invalidate the payment/invoice", async () => {
    sendOwnerInvoiceEmailMock.mockResolvedValue({ sent: false, reason: "NO_EMAIL_ON_FILE" });

    const { payment, invoice } = await ownerPaymentService.createPayment({ actorId: ADMIN_ID, input: validInput });

    expect(payment).toBeTruthy();
    expect(invoice).toBeTruthy();
    const actionTypes = activityLogMock.mock.calls.map((c) => c[0].actionType);
    expect(actionTypes).not.toContain("OWNER_INVOICE_SENT");
  });

  it("a reported send failure (SEND_FAILED) does not invalidate the payment/invoice", async () => {
    // The real `ownerInvoiceEmailService.sendOwnerInvoiceEmail` never throws —
    // it always resolves with { sent: false, reason: 'SEND_FAILED' } on error
    // (see owner-invoice-email-service.test.ts) — this is what that guarantee
    // looks like from `createPayment`'s point of view.
    sendOwnerInvoiceEmailMock.mockResolvedValue({ sent: false, reason: "SEND_FAILED" });

    const { payment, invoice } = await ownerPaymentService.createPayment({ actorId: ADMIN_ID, input: validInput });

    expect(payment).toBeTruthy();
    expect(invoice).toBeTruthy();
    const actionTypes = activityLogMock.mock.calls.map((c) => c[0].actionType);
    expect(actionTypes).not.toContain("OWNER_INVOICE_SENT");
  });
});

describe("ownerPaymentService.createPayment — WhatsApp invoice document is mandatory-but-best-effort", () => {
  it("logs OWNER_INVOICE_WHATSAPP_FAILED when the owner has no verified WhatsApp connection", async () => {
    sendOwnerInvoiceWhatsAppDocumentMock.mockResolvedValue({ sent: false, reason: "NO_VERIFIED_WHATSAPP" });

    const { payment, invoice } = await ownerPaymentService.createPayment({ actorId: ADMIN_ID, input: validInput });

    expect(payment).toBeTruthy();
    expect(invoice).toBeTruthy();
    const actionTypes = activityLogMock.mock.calls.map((c) => c[0].actionType);
    expect(actionTypes).not.toContain("OWNER_INVOICE_WHATSAPP_SENT");
    expect(actionTypes).toContain("OWNER_INVOICE_WHATSAPP_FAILED");
  });

  it("sends the invoice document (by invoice id) and logs OWNER_INVOICE_WHATSAPP_SENT on success", async () => {
    sendOwnerInvoiceWhatsAppDocumentMock.mockResolvedValue({ sent: true, messageId: "wamid.abc123" });

    const { invoice } = await ownerPaymentService.createPayment({ actorId: ADMIN_ID, input: validInput });

    expect(sendOwnerInvoiceWhatsAppDocumentMock).toHaveBeenCalledWith(invoice.id);
    const sentLog = activityLogMock.mock.calls.find((c) => c[0].actionType === "OWNER_INVOICE_WHATSAPP_SENT");
    expect(sentLog).toBeTruthy();
    expect(sentLog![0].metadata.message_id).toBe("wamid.abc123");
  });

  it("a WhatsApp send failure (e.g. template not configured) never invalidates the payment/invoice", async () => {
    sendOwnerInvoiceWhatsAppDocumentMock.mockResolvedValue({
      sent: false,
      reason: "TEMPLATE_NOT_CONFIGURED",
      detail: 'WhatsApp template "owner_invoice_ready_v1" was not found.',
    });

    const { payment, invoice } = await ownerPaymentService.createPayment({ actorId: ADMIN_ID, input: validInput });

    expect(payment).toBeTruthy();
    expect(invoice).toBeTruthy();
    const failedLog = activityLogMock.mock.calls.find((c) => c[0].actionType === "OWNER_INVOICE_WHATSAPP_FAILED");
    expect(failedLog![0].metadata.reason).toBe("TEMPLATE_NOT_CONFIGURED");
  });
});

describe("ownerPaymentService.createPayment — idempotency", () => {
  it("a repeated idempotency_key resolves to the original payment instead of creating a duplicate", async () => {
    const input = { ...validInput, idempotencyKey: "double-click-guard-1" };

    const first = await ownerPaymentService.createPayment({ actorId: ADMIN_ID, input });
    expect(first.alreadyExisted).toBe(false);
    expect(db.owner_payments.create).toHaveBeenCalledTimes(1);

    // Simulate the row now existing for that key.
    db.owner_payments.findUnique.mockResolvedValue(first.payment);
    db.owner_invoices.findUnique.mockResolvedValue(first.invoice);

    const second = await ownerPaymentService.createPayment({ actorId: ADMIN_ID, input });
    expect(second.alreadyExisted).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);
    // Still only ever created once.
    expect(db.owner_payments.create).toHaveBeenCalledTimes(1);
  });
});

describe("ownerPaymentService.listForOwner / voidPayment", () => {
  it("lists payments scoped to the given owner", async () => {
    db.owner_payments.findMany.mockResolvedValue([{ id: "p1", owner_id: OWNER_ID }]);
    const rows = await ownerPaymentService.listForOwner(OWNER_ID);
    expect(db.owner_payments.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { owner_id: OWNER_ID } }),
    );
    expect(rows).toHaveLength(1);
  });

  it("requires a reason to void a payment", async () => {
    await expect(
      ownerPaymentService.voidPayment({ paymentId: "p1", actorId: ADMIN_ID, reason: "" }),
    ).rejects.toSatisfy((e: any) => isOwnerBillingError(e) && e.code === "REASON_REQUIRED");
  });

  it("voids a recorded payment and audit-logs it, without deleting the row", async () => {
    db.owner_payments.updateMany.mockResolvedValue({ count: 1 });
    db.owner_payments.findUnique.mockResolvedValue({ id: "p1", owner_id: OWNER_ID, status: "VOIDED" });

    const voided = await ownerPaymentService.voidPayment({ paymentId: "p1", actorId: ADMIN_ID, reason: "Duplicate entry" });

    expect(voided?.status).toBe("VOIDED");
    expect(db.owner_payments.updateMany).toHaveBeenCalled();
    const actionTypes = activityLogMock.mock.calls.map((c) => c[0].actionType);
    expect(actionTypes).toContain("OWNER_PAYMENT_VOIDED");
  });

  it("refuses to void an already-voided or missing payment", async () => {
    db.owner_payments.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      ownerPaymentService.voidPayment({ paymentId: "p1", actorId: ADMIN_ID, reason: "Duplicate entry" }),
    ).rejects.toSatisfy((e: any) => isOwnerBillingError(e) && e.code === "NOT_REVIEWABLE");
  });
});
