import { prisma } from "../../lib/db";

export class InvoiceRepository {
  async getReceiptByPaymentId(paymentId: string) {
    return await prisma.receipts.findFirst({
      where: { payment_id: paymentId },
      include: {
        payments: true,
        tenants: { include: { profiles: true } }
      }
    });
  }

  async getPaymentWithObligationAndTenant(paymentId: string) {
    return await prisma.payments.findUnique({
      where: { id: paymentId },
      include: { obligation: true, tenants: { include: { profiles: true } } }
    });
  }

  async getReceiptByIdAndVersion(receiptId: string, version: number) {
    return await prisma.receipts.findUnique({
      where: { id: receiptId },
      select: { invoice_pdf_url: true, invoice_template_version: true },
    });
  }
}

export const invoiceRepository = new InvoiceRepository();
