/**
 * Generic owner-invoice **document** generation + retrieval — the same
 * pattern as `platform-billing/subscription-invoice-document-service.ts`:
 *
 *  - generation is best-effort and out of the payment-creation transaction;
 *  - the rendered PDF is stored in ImageKit (the repo's only file store),
 *    under its own `/owner_invoices` folder (kept separate from
 *    `/subscription_invoices` so the two document sets never mix in ImageKit
 *    either);
 *  - the raw ImageKit URL is never handed to clients — downloads are proxied
 *    through the owner/admin routes.
 *
 * All financial values come from the invoice row. Nothing is recomputed here.
 */
import { prisma } from "@/lib/db";
import { imagekit } from "@/lib/imagekit";
import { buildOwnerInvoiceContent } from "@/lib/pdf/owner-invoice-content";
import { renderOwnerInvoicePdf } from "@/lib/pdf/owner-invoice-template-pdf-lib";
import { OwnerBillingError } from "./owner-billing-errors";

function joinAddress(profile: any): string | null {
  const parts = [profile?.address, profile?.city, profile?.state, profile?.pincode]
    .map((p: any) => String(p ?? "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

async function loadInvoice(invoiceId: string) {
  const invoice = await prisma.owner_invoices.findUnique({
    where: { id: invoiceId },
    include: {
      profile: {
        select: {
          name: true,
          email: true,
          phone: true,
          address: true,
          city: true,
          state: true,
          pincode: true,
          owner_billing_profile: {
            select: { billing_name: true, billing_email: true, billing_phone: true, billing_address: true },
          },
        },
      },
    },
  });
  if (!invoice) throw new OwnerBillingError("Invoice not found.", "NOT_FOUND", 404);
  return invoice;
}

function buildContent(invoice: any) {
  const p = invoice.profile ?? {};
  const bp = p.owner_billing_profile ?? {};
  return buildOwnerInvoiceContent({
    invoiceNumber: invoice.invoice_number,
    issuedAt: invoice.issued_at,
    billingName: bp.billing_name || p.name || null,
    billingEmail: bp.billing_email || p.email || null,
    billingPhone: bp.billing_phone || p.phone || null,
    billingAddress: bp.billing_address || joinAddress(p),
    description: invoice.description,
    amountPaise: invoice.amount_paise,
    taxPaise: invoice.tax_paise,
    currency: invoice.currency,
    paymentMethod: invoice.payment_method,
    transactionReference: invoice.transaction_reference,
  });
}

async function render(invoice: any): Promise<Buffer> {
  const content = buildContent(invoice);
  const bytes = await renderOwnerInvoicePdf(content);
  return Buffer.from(bytes);
}

/** ImageKit-safe file name for an invoice. */
function fileNameFor(invoiceNumber: string): string {
  return `${String(invoiceNumber).replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
}

/**
 * Render the PDF, upload it to ImageKit and persist the URL on the row.
 * Best-effort: a failure throws, and callers in the payment-creation path swallow it.
 */
async function generateDocument(invoiceId: string): Promise<{ bytes: Buffer; documentUrl: string | null }> {
  const invoice = await loadInvoice(invoiceId);
  const bytes = await render(invoice);

  let documentUrl: string | null = invoice.document_url ?? null;
  try {
    const upload = await imagekit.files.upload({
      file: bytes.toString("base64"),
      fileName: fileNameFor(invoice.invoice_number),
      folder: "/owner_invoices",
      tags: ["owner-invoice", invoice.id],
    });
    if (upload?.url) {
      documentUrl = upload.url;
      await prisma.owner_invoices.update({
        where: { id: invoice.id },
        data: { document_url: upload.url, updated_at: new Date() },
      });
    }
  } catch (err: any) {
    console.warn("[owner-invoice-document] upload failed (non-fatal):", err?.message);
  }

  return { bytes, documentUrl };
}

/**
 * Return the invoice PDF bytes for a download. Uses the stored ImageKit copy
 * when present (and still fetchable), otherwise renders fresh and, as a side
 * effect, backfills `document_url`.
 */
async function getDocumentBytes(invoiceId: string): Promise<{ bytes: Buffer; fileName: string }> {
  const invoice = await loadInvoice(invoiceId);
  const fileName = fileNameFor(invoice.invoice_number);

  if (invoice.document_url) {
    try {
      const res = await fetch(invoice.document_url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 0) return { bytes: buf, fileName };
      }
    } catch {
      // CDN miss / network — fall through to a fresh render.
    }
  }

  const { bytes } = await generateDocument(invoiceId);
  return { bytes, fileName };
}

export const ownerInvoiceDocumentService = {
  generateDocument,
  getDocumentBytes,
};
