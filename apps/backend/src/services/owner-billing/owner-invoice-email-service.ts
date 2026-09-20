/**
 * Emails an `owner_invoices` PDF to the owner — the "Invoice emailed to
 * Owner" step of the generic owner-payment flow. Uses the existing
 * `EmailService`/Resend integration (`EmailService.sendOwnerPaymentInvoice`)
 * and the existing `ownerInvoiceDocumentService` PDF pipeline — no new email
 * provider, no new PDF renderer beyond the owner-invoice one already built
 * for this feature.
 *
 * Deliberately best-effort and retryable (business requirement): a missing
 * owner email, or any send failure, is recorded on the invoice row
 * (`email_failed_at`) and swallowed — it must never invalidate the payment or
 * invoice that already exist. `resendInvoiceEmail` lets an admin retry after
 * fixing the owner's email on file.
 */
import { prisma } from "@/lib/db";
import { EmailService } from "@/lib/services/email-service";
import { formatInvoiceDate, formatPaiseInr } from "@/lib/pdf/subscription-invoice-content";
import { ownerPaymentMethodLabel } from "@/lib/pdf/owner-invoice-content";
import { ownerInvoiceDocumentService } from "./owner-invoice-document-service";
import { OwnerBillingError } from "./owner-billing-errors";

async function loadRecipient(invoiceId: string) {
  const invoice = await prisma.owner_invoices.findUnique({
    where: { id: invoiceId },
    include: {
      profile: {
        select: {
          name: true,
          email: true,
          owner_billing_profile: { select: { billing_name: true, billing_email: true } },
        },
      },
    },
  });
  if (!invoice) throw new OwnerBillingError("Invoice not found.", "NOT_FOUND", 404);

  const p: any = invoice.profile ?? {};
  const bp: any = p.owner_billing_profile ?? {};
  const toEmail: string | null = (bp.billing_email || p.email || "").trim() || null;
  const ownerName: string = bp.billing_name || p.name || "there";

  return { invoice, toEmail, ownerName };
}

/**
 * Send (or resend) the invoice email. Never throws — a failure updates
 * `email_failed_at` and resolves normally, so a caller firing this
 * immediately after payment creation can safely ignore the result.
 */
async function sendOwnerInvoiceEmail(invoiceId: string): Promise<{ sent: boolean; reason?: string }> {
  try {
    const { invoice, toEmail, ownerName } = await loadRecipient(invoiceId);

    if (!toEmail) {
      await prisma.owner_invoices.update({
        where: { id: invoiceId },
        data: { email_failed_at: new Date() },
      });
      return { sent: false, reason: "NO_EMAIL_ON_FILE" };
    }

    const { bytes } = await ownerInvoiceDocumentService.getDocumentBytes(invoiceId);

    await EmailService.sendOwnerPaymentInvoice({
      toEmail,
      ownerName,
      amountLabel: formatPaiseInr(invoice.amount_paise + invoice.tax_paise),
      description: invoice.description,
      paymentMethodLabel: ownerPaymentMethodLabel(invoice.payment_method),
      invoiceNumber: invoice.invoice_number,
      paymentDateLabel: formatInvoiceDate(invoice.issued_at),
      pdfBuffer: bytes,
    });

    await prisma.owner_invoices.update({
      where: { id: invoiceId },
      data: { emailed_at: new Date(), email_failed_at: null },
    });
    return { sent: true };
  } catch (err: any) {
    console.warn("[owner-invoice-email] send failed (non-fatal):", err?.message);
    await prisma.owner_invoices
      .update({ where: { id: invoiceId }, data: { email_failed_at: new Date() } })
      .catch(() => {});
    return { sent: false, reason: "SEND_FAILED" };
  }
}

export const ownerInvoiceEmailService = {
  sendOwnerInvoiceEmail,
};
