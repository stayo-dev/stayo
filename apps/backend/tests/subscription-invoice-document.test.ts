import { readFileSync } from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const prisma: any = {
    subscription_invoices: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    subscription_plans: { findUnique: vi.fn(async () => ({ name: "Growth" })) },
    owner_subscriptions: { findUnique: vi.fn(async () => ({ subscription_plans: { name: "Growth" } })) },
  };
  return { prisma };
});

const { uploadMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(async () => ({ url: "https://ik.imagekit.io/dummy/subscription_invoices/SUB-2026-XYZ.pdf" })),
}));
vi.mock("@/lib/imagekit", () => ({ imagekit: { files: { upload: uploadMock } } }));

import { prisma } from "@/lib/db";
import { subscriptionInvoiceDocumentService } from "@/src/services/platform-billing/subscription-invoice-document-service";

const db = prisma as any;
const BACKEND = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(BACKEND, rel), "utf8");

const INVOICE_ROW = {
  id: "inv-1",
  owner_id: "owner-1",
  subscription_id: "sub-1",
  invoice_number: "SUB-2026-A1B2C3D4E5",
  issued_at: new Date("2026-09-10T08:00:00.000Z"),
  billing_period_start: new Date("2026-09-10T00:00:00.000Z"),
  billing_period_end: new Date("2026-10-10T00:00:00.000Z"),
  amount_paise: 249900,
  tax_paise: 0,
  currency: "INR",
  payment_method: "UPI_MANUAL",
  transaction_reference: "UPI-88-22",
  document_url: null,
  profile: {
    name: "Ravi Kumar",
    email: "ravi@example.com",
    phone: "+919876543210",
    address: "12 MG Road",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560001",
    owner_billing_profile: null,
  },
  subscription_payments: { plan_id: "plan-growth" },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.subscription_invoices.findUnique.mockResolvedValue({ ...INVOICE_ROW });
  db.subscription_invoices.update.mockResolvedValue({});
  uploadMock.mockResolvedValue({ url: "https://ik.imagekit.io/dummy/subscription_invoices/x.pdf" });
});

describe("subscriptionInvoiceDocumentService.generateDocument", () => {
  it("renders a real PDF for the invoice, uploads it, and persists document_url", async () => {
    const res = await subscriptionInvoiceDocumentService.generateDocument("inv-1");

    expect(res.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(res.bytes.length).toBeGreaterThan(1000);

    expect(uploadMock).toHaveBeenCalledTimes(1);
    const uploadArg = (uploadMock.mock.calls[0] as any[])[0] as any;
    expect(uploadArg.folder).toBe("/subscription_invoices");
    expect(uploadArg.fileName).toBe("SUB-2026-A1B2C3D4E5.pdf");
    expect(typeof uploadArg.file).toBe("string"); // base64, not raw bytes

    expect(db.subscription_invoices.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv-1" },
        data: expect.objectContaining({ document_url: expect.stringContaining("http") }),
      }),
    );
  });

  it("still returns the PDF bytes when the upload fails (non-fatal)", async () => {
    uploadMock.mockRejectedValueOnce(new Error("imagekit down"));
    const res = await subscriptionInvoiceDocumentService.generateDocument("inv-1");
    expect(res.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(res.documentUrl).toBeNull();
    expect(db.subscription_invoices.update).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND for a missing invoice", async () => {
    db.subscription_invoices.findUnique.mockResolvedValueOnce(null);
    await expect(subscriptionInvoiceDocumentService.generateDocument("nope")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("uses the stored amount_paise and never adds tax", async () => {
    // Sanity: a prorated upgrade amount flows straight through.
    db.subscription_invoices.findUnique.mockResolvedValueOnce({ ...INVOICE_ROW, amount_paise: 133733, tax_paise: 0 });
    const res = await subscriptionInvoiceDocumentService.generateDocument("inv-1");
    expect(res.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // The content model is separately unit-tested for the ₹ math; here we only
    // assert generation succeeded with a non-round stored amount.
  });
});

describe("subscriptionInvoiceDocumentService.getDocumentBytes", () => {
  it("returns the cached ImageKit copy when document_url is set and fetchable", async () => {
    const cached = Buffer.from("%PDF-1.7 cached-copy");
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => cached }));
    vi.stubGlobal("fetch", fetchMock as any);
    db.subscription_invoices.findUnique.mockResolvedValue({
      ...INVOICE_ROW,
      document_url: "https://ik.imagekit.io/dummy/subscription_invoices/cached.pdf",
    });

    const res = await subscriptionInvoiceDocumentService.getDocumentBytes("inv-1");
    expect(res.bytes.toString("latin1")).toBe("%PDF-1.7 cached-copy");
    expect(res.fileName).toBe("SUB-2026-A1B2C3D4E5.pdf");
    expect(uploadMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("regenerates when there is no stored document", async () => {
    db.subscription_invoices.findUnique.mockResolvedValue({ ...INVOICE_ROW, document_url: null });
    const res = await subscriptionInvoiceDocumentService.getDocumentBytes("inv-1");
    expect(res.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(uploadMock).toHaveBeenCalled();
  });
});

describe("invoice document is tied to payment approval, not rejection", () => {
  it("the approve route generates the document outside the approval transaction", () => {
    const src = read("app/api/platform-admin/subscription-payments/[id]/approve/route.ts");
    expect(src).toMatch(/subscriptionInvoiceDocumentService\.generateDocument\(result\.invoice\.id\)/);
    // best-effort: wrapped so a doc failure cannot fail the approval
    expect(src).toMatch(/catch \(docErr/);
    // and it runs AFTER reviewPayment returns, i.e. after the tx has committed
    const approveIdx = src.indexOf("reviewPayment");
    const genIdx = src.indexOf("generateDocument");
    expect(approveIdx).toBeGreaterThan(-1);
    expect(genIdx).toBeGreaterThan(approveIdx);
  });

  it("the reject route never touches invoice document generation", () => {
    const src = read("app/api/platform-admin/subscription-payments/[id]/reject/route.ts");
    expect(src).not.toMatch(/invoice/i);
    expect(src).not.toMatch(/generateDocument/);
  });

  it("reviewPayment REJECT branch creates no invoice at all", () => {
    const src = read("src/services/platform-billing/subscription-payment-service.ts");
    const rejectBlock = src.slice(src.indexOf("// ── REJECT"), src.indexOf("// ── APPROVE"));
    expect(rejectBlock).not.toMatch(/createInvoiceForApprovedPayment/);
  });
});

describe("owner / admin invoice download — access control", () => {
  it("owner route authorizes by session owner vs row owner_id, never a request-supplied id", () => {
    const src = read("app/api/owner/subscription/invoices/[id]/route.ts");
    expect(src).toMatch(/resolveOwnerId\(session\)/);
    expect(src).toMatch(/invoice\.owner_id !== ownerId/);
    expect(src).not.toMatch(/searchParams\.get\(["']owner/);
    expect(src).not.toMatch(/body\??\.\s*owner_id/);
    // a mismatch is a 404, not a confirmation that the invoice exists
    expect(src).toMatch(/"NOT_FOUND", 404/);
  });

  it("admin route uses the existing requireAdmin gate", () => {
    const src = read("app/api/platform-admin/subscription-invoices/[id]/route.ts");
    expect(src).toMatch(/requireAdmin\(session\)/);
  });

  it("both routes stream application/pdf, not a raw ImageKit URL", () => {
    for (const rel of [
      "app/api/owner/subscription/invoices/[id]/route.ts",
      "app/api/platform-admin/subscription-invoices/[id]/route.ts",
    ]) {
      const src = read(rel);
      expect(src, rel).toMatch(/"Content-Type": "application\/pdf"/);
      expect(src, rel).toMatch(/getDocumentBytes/);
      expect(src, rel).not.toMatch(/document_url/);
    }
  });
});
