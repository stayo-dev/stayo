/**
 * Generic owner-invoice records. An `owner_invoices` row is created in the
 * SAME transaction as its `owner_payments` row (see `owner-payment-service.ts`)
 * — there is no "payment recorded, invoice missing" state, mirroring how
 * `subscription-invoice-service.ts#createInvoiceForApprovedPayment` runs
 * inside the approval transaction.
 *
 * This domain never touches `subscription_payments`/`subscription_invoices`
 * or the tenant-rent invoice/receipt tables.
 */
import crypto from "crypto";

/** `STY-2026-A1B2C3D4` — unique enough; the DB `invoice_number` UNIQUE index is the backstop. */
export function makeOwnerInvoiceNumber(now = new Date()): string {
  return `STY-${now.getUTCFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

type OwnerPaymentRow = {
  id: string;
  owner_id: string;
  amount_paise: number;
  description: string;
  payment_method: string;
  transaction_reference: string | null;
};

/** Create the invoice for a just-created owner payment. Must run inside the same transaction. */
export async function createOwnerInvoiceForPayment(tx: any, payment: OwnerPaymentRow) {
  return tx.owner_invoices.create({
    data: {
      owner_id: payment.owner_id,
      payment_id: payment.id,
      invoice_number: makeOwnerInvoiceNumber(),
      description: payment.description,
      amount_paise: payment.amount_paise,
      tax_paise: 0, // Stayo is not GST-registered — reserved, always 0.
      payment_method: payment.payment_method as any,
      transaction_reference: payment.transaction_reference,
    },
  });
}
