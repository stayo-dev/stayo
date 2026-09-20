/**
 * Pure view logic for the generic "Owner Payments" feature (Admin → Owner →
 * Billing / Payments → Add Payment). Deliberately separate from
 * `subscriptionAdminView.ts` — this is NOT a subscription payment, so it gets
 * its own payment-method vocabulary (`CASH` / `UPI` / `BANK_TRANSFER`, no
 * `GATEWAY`) and its own client-side form validation, mirroring what
 * `owner-payment-service.ts` enforces server-side (the backend remains the
 * final authority; this only gives the modal fast, friendly feedback before
 * a round trip).
 *
 * Backend owns every financial value; this module only formats/validates.
 * Node-env test convention (`.ts`, not `.tsx` — no component rendering).
 */

export const OWNER_PAYMENT_METHODS = ['CASH', 'UPI', 'BANK_TRANSFER'] as const;
export type OwnerPaymentMethod = (typeof OWNER_PAYMENT_METHODS)[number];

export const OWNER_PAYMENT_DESCRIPTION_MAX_LENGTH = 240;
export const OWNER_PAYMENT_NOTES_MAX_LENGTH = 1000;

export function ownerPaymentMethodLabel(method: string | null | undefined): string {
  switch (String(method || '').toUpperCase()) {
    case 'CASH':
      return 'Cash';
    case 'UPI':
      return 'UPI';
    case 'BANK_TRANSFER':
      return 'Bank transfer';
    default:
      return String(method || '—');
  }
}

export interface AddOwnerPaymentFormInput {
  amountRupees: string;
  paymentMethod: string;
  description: string;
  notes?: string;
}

export interface AddOwnerPaymentFormResult {
  ok: boolean;
  reason?: string;
  /** Only present when `ok` — the payload ready to send to the backend. */
  amountPaise?: number;
}

/**
 * Client-side validation for the Add Payment modal — required amount/method/
 * description, sensible description length, positive-integer paise. The
 * backend re-validates everything independently and is the only source of
 * truth for what actually gets recorded.
 */
export function validateAddOwnerPaymentForm(input: AddOwnerPaymentFormInput): AddOwnerPaymentFormResult {
  const rupees = Number(String(input.amountRupees ?? '').trim());
  if (!input.amountRupees || !Number.isFinite(rupees) || rupees <= 0) {
    return { ok: false, reason: 'Enter an amount greater than ₹0.' };
  }
  const amountPaise = Math.round(rupees * 100);
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    return { ok: false, reason: 'Enter a valid amount.' };
  }

  const method = String(input.paymentMethod || '').toUpperCase();
  if (!OWNER_PAYMENT_METHODS.includes(method as OwnerPaymentMethod)) {
    return { ok: false, reason: 'Choose a payment method.' };
  }

  const description = String(input.description || '').trim();
  if (!description) {
    return { ok: false, reason: 'Describe what this payment is for.' };
  }
  if (description.length > OWNER_PAYMENT_DESCRIPTION_MAX_LENGTH) {
    return { ok: false, reason: `Description must be ${OWNER_PAYMENT_DESCRIPTION_MAX_LENGTH} characters or fewer.` };
  }

  const notes = String(input.notes || '').trim();
  if (notes.length > OWNER_PAYMENT_NOTES_MAX_LENGTH) {
    return { ok: false, reason: `Notes must be ${OWNER_PAYMENT_NOTES_MAX_LENGTH} characters or fewer.` };
  }

  return { ok: true, amountPaise };
}

export type OwnerInvoiceWhatsAppStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface OwnerPaymentRow {
  id: string;
  amount_paise: number;
  payment_method: string;
  description: string;
  status: string;
  created_at: string;
  invoice: {
    id: string;
    invoice_number: string;
    email: { sent: boolean; sent_at?: string | null; failed_at?: string | null };
    whatsapp: { status: OwnerInvoiceWhatsAppStatus; sent_at?: string | null; error?: string | null };
  } | null;
}

/** Whether the invoice-email indicator should show a "failed" hint the admin can act on (resend). */
export function invoiceEmailNeedsAttention(row: OwnerPaymentRow): boolean {
  return Boolean(row.invoice && !row.invoice.email.sent && row.invoice.email.failed_at);
}

/** Whether the WhatsApp indicator should show a "failed"/retry hint. */
export function invoiceWhatsAppNeedsAttention(row: OwnerPaymentRow): boolean {
  return row.invoice?.whatsapp.status === 'FAILED';
}

export function whatsAppStatusLabel(status: OwnerInvoiceWhatsAppStatus | undefined): string {
  switch (status) {
    case 'SENT':
      return 'Sent';
    case 'FAILED':
      return 'Failed';
    default:
      return 'Pending';
  }
}
