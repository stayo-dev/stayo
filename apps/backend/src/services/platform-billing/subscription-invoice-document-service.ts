/**
 * Subscription invoice **document** generation + retrieval (ADR-172, Phase 6.2).
 *
 * A `subscription_invoices` row is the financial record (created atomically on
 * payment approval — see `subscription-invoice-service.ts`). This service turns
 * that row into a downloadable PDF:
 *
 *  - generation is **best-effort and out of the approval transaction** — a
 *    storage hiccup must never leave an approved payment without its invoice
 *    row, so document creation is decoupled from it;
 *  - the rendered PDF is stored in ImageKit (the repo's only file store — same
 *    as receipts, KYC docs, payment proofs) and its URL persisted on
 *    `subscription_invoices.document_url`;
 *  - PostgreSQL never holds the PDF bytes;
 *  - the raw ImageKit URL is **not** handed to clients — downloads are proxied
 *    through the owner/admin routes so access control is enforced on every
 *    fetch.
 *
 * All financial values come from the invoice row. Nothing is recomputed here.
 * `tax_paise` is passed straight through (always 0 this phase). No GST.
 */
import { prisma } from "@/lib/db";
import { imagekit } from "@/lib/imagekit";
import { buildSubscriptionInvoiceContent } from "@/lib/pdf/subscription-invoice-content";
import { renderSubscriptionInvoicePdf } from "@/lib/pdf/subscription-invoice-template-pdf-lib";
import { SubscriptionError } from "./subscription-errors";

function joinAddress(profile: any): string | null {
  const parts = [profile?.address, profile?.city, profile?.state, profile?.pincode]
    .map((p: any) => String(p ?? "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

async function loadInvoice(invoiceId: string) {
  const invoice = await prisma.subscription_invoices.findUnique({
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
      subscription_payments: { select: { plan_id: true } },
    },
  });
  if (!invoice) throw new SubscriptionError("Invoice not found.", "NOT_FOUND", 404);
  return invoice;
}

function buildContent(invoice: any, planName: string | null) {
  const p = invoice.profile ?? {};
  const bp = p.owner_billing_profile ?? {};
  return buildSubscriptionInvoiceContent({
    invoiceNumber: invoice.invoice_number,
    issuedAt: invoice.issued_at,
    billingName: bp.billing_name || p.name || null,
    billingEmail: bp.billing_email || p.email || null,
    billingPhone: bp.billing_phone || p.phone || null,
    billingAddress: bp.billing_address || joinAddress(p),
    planName,
    billingPeriodStart: invoice.billing_period_start,
    billingPeriodEnd: invoice.billing_period_end,
    extraBeds: invoice.extra_beds,
    // SNAPSHOTTED on the invoice row itself (Phase 6.6) — never re-read from
    // the live plan, so a later admin price edit can't change what an
    // already-issued invoice says it charged.
    extraBedUnitPricePaise: invoice.extra_bed_unit_price_paise,
    extraBedAmountPaise: invoice.extra_bed_amount_paise,
    planAmountPaise: invoice.plan_amount_paise,
    amountPaise: invoice.amount_paise,
    taxPaise: invoice.tax_paise,
    currency: invoice.currency,
    paymentMethod: invoice.payment_method,
    transactionReference: invoice.transaction_reference,
  });
}

/** Plan NAME only — not money-sensitive, fine to resolve live (a rename should show on old invoices too). */
async function resolvePlanName(invoice: any): Promise<string | null> {
  const planId = invoice.subscription_payments?.plan_id;
  if (planId) {
    const plan = await prisma.subscription_plans.findUnique({ where: { id: planId }, select: { name: true } });
    if (plan?.name) return plan.name;
  }
  const sub = await prisma.owner_subscriptions.findUnique({
    where: { id: invoice.subscription_id },
    select: { subscription_plans: { select: { name: true } } },
  });
  return sub?.subscription_plans?.name ?? null;
}

async function render(invoice: any): Promise<Buffer> {
  const planName = await resolvePlanName(invoice);
  const content = buildContent(invoice, planName);
  const bytes = await renderSubscriptionInvoicePdf(content);
  return Buffer.from(bytes);
}

/** ImageKit-safe file name for an invoice. */
function fileNameFor(invoiceNumber: string): string {
  return `${String(invoiceNumber).replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
}

/**
 * Render the PDF, upload it to ImageKit and persist the URL on the row.
 * Best-effort: a failure throws, and callers in the approval path swallow it.
 */
async function generateDocument(invoiceId: string): Promise<{ bytes: Buffer; documentUrl: string | null }> {
  const invoice = await loadInvoice(invoiceId);
  const bytes = await render(invoice);

  let documentUrl: string | null = invoice.document_url ?? null;
  try {
    const upload = await imagekit.files.upload({
      file: bytes.toString("base64"),
      fileName: fileNameFor(invoice.invoice_number),
      folder: "/subscription_invoices",
      tags: ["subscription-invoice", invoice.id],
    });
    if (upload?.url) {
      documentUrl = upload.url;
      await prisma.subscription_invoices.update({
        where: { id: invoice.id },
        data: { document_url: upload.url, updated_at: new Date() },
      });
    }
  } catch (err: any) {
    // Non-fatal: the caller still gets the bytes; the row keeps document_url = null
    // and the next download attempt will retry the upload.
    console.warn("[subscription-invoice-document] upload failed (non-fatal):", err?.message);
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

export const subscriptionInvoiceDocumentService = {
  generateDocument,
  getDocumentBytes,
};
