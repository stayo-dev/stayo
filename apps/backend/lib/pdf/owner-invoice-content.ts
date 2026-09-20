/**
 * Generic **owner invoice** content model — the financial document for a
 * one-off `owner_payments` charge (tenant onboarding cost, custom setup
 * work, ad-hoc support, etc.), NOT a subscription invoice.
 *
 * Reuses the money/date formatting helpers already proven in
 * `subscription-invoice-content.ts` (`formatPaiseInr`, `formatInvoiceDate`)
 * rather than re-implementing them — this module only differs in *what* it
 * lays out (a free-text description entered by an admin, not a plan/period).
 *
 * Same "no GST" rule as the subscription invoice (Stayo is not
 * GST-registered): `tax_paise` is always 0 today, shown as a plain ₹0.00 line.
 *
 * PURE MODULE — no pdf-lib, no fonts, no I/O.
 */
import { formatInvoiceDate, formatPaiseInr } from "./subscription-invoice-content";

export interface OwnerInvoiceContentInput {
  invoiceNumber: string;
  issuedAt: Date | string;

  billingName?: string | null;
  billingEmail?: string | null;
  billingPhone?: string | null;
  billingAddress?: string | null;

  /** Admin-entered description of what this payment is for. Always shown verbatim. */
  description: string;

  /** Integer paise, straight from `owner_invoices`. */
  amountPaise: number;
  taxPaise: number;
  currency?: string | null;

  /** `CASH` | `UPI` | `BANK_TRANSFER`. */
  paymentMethod: string;
  transactionReference?: string | null;
}

export interface OwnerInvoiceRow {
  label: string;
  value: string;
}

export interface OwnerInvoiceContent {
  brandName: string;
  docTitle: string;

  invoiceNumber: string;
  issueDateLabel: string;
  statusLabel: string;

  billTo: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
  };

  description: string;

  payment: {
    methodLabel: string;
    transactionReference: string | null;
    currency: string;
  };

  summary: {
    subtotal: OwnerInvoiceRow;
    tax: OwnerInvoiceRow;
    total: OwnerInvoiceRow;
  };

  amountPaise: number;
  taxPaise: number;
  totalPaise: number;

  footerNote: string;
}

/** Owner-facing label for a stored `OwnerPaymentMethod`. */
export function ownerPaymentMethodLabel(method: string | null | undefined): string {
  switch (String(method || "").toUpperCase()) {
    case "CASH":
      return "Cash";
    case "UPI":
      return "UPI";
    case "BANK_TRANSFER":
      return "Bank transfer";
    default:
      return String(method || "—");
  }
}

function clean(value: string | null | undefined): string | null {
  const s = String(value ?? "").trim();
  return s.length > 0 ? s : null;
}

export function buildOwnerInvoiceContent(input: OwnerInvoiceContentInput): OwnerInvoiceContent {
  const amountPaise = Number.isFinite(input.amountPaise) ? Math.trunc(input.amountPaise) : 0;
  // Defensive: always 0 today, but shown truthfully as a plain amount — never labelled "GST".
  const taxPaise = Number.isFinite(input.taxPaise) ? Math.trunc(input.taxPaise) : 0;
  const totalPaise = amountPaise + taxPaise;
  const currency = (clean(input.currency) || "INR").toUpperCase();

  return {
    brandName: "Stayo",
    docTitle: "Invoice",

    invoiceNumber: String(input.invoiceNumber || "—"),
    issueDateLabel: formatInvoiceDate(input.issuedAt),
    statusLabel: "PAID",

    billTo: {
      name: clean(input.billingName) || "Account holder",
      email: clean(input.billingEmail),
      phone: clean(input.billingPhone),
      address: clean(input.billingAddress),
    },

    description: clean(input.description) || "Payment to Stayo",

    payment: {
      methodLabel: ownerPaymentMethodLabel(input.paymentMethod),
      transactionReference: clean(input.transactionReference),
      currency,
    },

    summary: {
      subtotal: { label: "Subtotal", value: formatPaiseInr(amountPaise) },
      tax: { label: "Tax", value: formatPaiseInr(taxPaise) },
      total: { label: "Total paid", value: formatPaiseInr(totalPaise) },
    },

    amountPaise,
    taxPaise,
    totalPaise,

    footerNote: "Stayo · This is a computer-generated invoice.",
  };
}
