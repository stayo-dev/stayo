/**
 * The Stayo **subscription invoice**'s content model — what the document says,
 * decided separately from how it is drawn (ADR-172, Phase 6.2).
 *
 * This is the invoice for what an *owner* pays *Stayo* for the platform
 * subscription. It has nothing to do with tenant rent, `rent_obligations`,
 * `receipts`, or the tenant-facing `invoice-service.ts` — a different revenue
 * stream with a different document.
 *
 * Rules that shape every line here:
 *
 *  - **Stayo is not GST-registered.** There is no GST, no GSTIN, no tax
 *    percentage, no "tax invoice" claim. `tax_paise` is whatever the database
 *    row carries (always 0 in this phase) and is shown as a plain ₹0.00 line so
 *    the totals add up on their face — never as "GST".
 *  - **Money is integer paise.** Every amount displayed is derived from the
 *    stored `amount_paise` / `tax_paise` by integer arithmetic; the rupee
 *    string is formatted once, here. The frontend never recomputes it.
 *  - The invoice number is the one the backend already generated on the
 *    `subscription_invoices` row. This module never mints one.
 *
 * PURE MODULE — no pdf-lib, no fonts, no I/O. Tested directly, the same split
 * `receipt-content.ts` / `menu-content.ts` use.
 */

export interface SubscriptionInvoiceContentInput {
  invoiceNumber: string;
  issuedAt: Date | string;

  /** Billing-to identity. Prefer the owner_billing_profiles values, fall back to the profile. */
  billingName?: string | null;
  billingEmail?: string | null;
  billingPhone?: string | null;
  billingAddress?: string | null;

  planName?: string | null;
  billingPeriodStart: Date | string;
  billingPeriodEnd: Date | string;

  /**
   * Extra beds this invoice covers (business rules, 2026-09-10) — the
   * subscription's resulting TOTAL, not the incremental delta bought this
   * time. `extraBedUnitPricePaise` is the per-bed price SNAPSHOTTED on the
   * invoice row at creation, not read live from the plan — a later admin
   * price edit must never change what an already-issued invoice says it
   * charged. `extraBedAmountPaise` is what was actually charged this
   * invoice for extra beds (priced on the incremental beds for a same-plan
   * top-up). All 0 / null when this invoice has no extra beds.
   */
  extraBeds?: number | null;
  extraBedUnitPricePaise?: number | null;
  extraBedAmountPaise?: number | null;
  /** Plan-only portion of `amountPaise` (Phase 6.6). */
  planAmountPaise: number;

  /** Integer paise, straight from `subscription_invoices`. Already includes any extra-bed cost. */
  amountPaise: number;
  taxPaise: number;
  currency?: string | null;

  /** `UPI_MANUAL` | `CASH` | `GATEWAY` (future). */
  paymentMethod: string;
  transactionReference?: string | null;
}

export interface SubscriptionInvoiceRow {
  label: string;
  value: string;
}

export interface SubscriptionInvoiceContent {
  brandName: string;
  docTitle: string;

  invoiceNumber: string;
  issueDateLabel: string;

  billTo: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
  };

  subscription: {
    planName: string;
    periodStartLabel: string;
    periodEndLabel: string;
    /** e.g. "10 extra beds @ ₹10.00/bed" — null when the invoice has no extra beds. */
    extraBedsLabel: string | null;
  };

  payment: {
    methodLabel: string;
    transactionReference: string | null;
    currency: string;
  };

  /**
   * Right-hand summary block (Phase 6.6). `plan` is always present (the plan
   * amount, even when it's the whole total); `extraBeds` is present only when
   * this invoice actually charged for extra beds — the two always add up to
   * `subtotal`, which stays for backward compatibility. `tax` is always
   * present and always ₹0-style.
   */
  summary: {
    plan: SubscriptionInvoiceRow;
    extraBeds: SubscriptionInvoiceRow | null;
    subtotal: SubscriptionInvoiceRow;
    tax: SubscriptionInvoiceRow;
    total: SubscriptionInvoiceRow;
  };

  /** Raw integers, exposed for tests and for any caller that needs the numbers. */
  amountPaise: number;
  taxPaise: number;
  totalPaise: number;

  footerNote: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "10 September 2026" in UTC — invoices are date-stamped, not time-stamped. */
export function formatInvoiceDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Integer paise → an Indian-grouped rupee string, e.g. 149900 → "₹1,499.00",
 * 799900 → "₹7,999.00", 4499900 → "₹44,999.00". Never floating-point: the
 * rupee and paise parts are split with integer division and modulo.
 */
export function formatPaiseInr(paise: number): string {
  const safe = Number.isFinite(paise) ? Math.trunc(paise) : 0;
  const negative = safe < 0;
  const abs = Math.abs(safe);
  const rupees = Math.floor(abs / 100);
  const paiseRem = abs % 100;

  const digits = String(rupees);
  let grouped: string;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    const head = digits.slice(0, digits.length - 3);
    const tail = digits.slice(digits.length - 3);
    grouped = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + tail;
  }
  return `${negative ? "-" : ""}₹${grouped}.${String(paiseRem).padStart(2, "0")}`;
}

/** Owner-facing label for a stored payment method. GATEWAY is future-ready, never implemented here. */
export function paymentMethodLabel(method: string | null | undefined): string {
  switch (String(method || "").toUpperCase()) {
    case "UPI_MANUAL":
      return "UPI";
    case "CASH":
      return "Cash";
    case "GATEWAY":
      return "Online payment";
    default:
      return String(method || "—");
  }
}

function clean(value: string | null | undefined): string | null {
  const s = String(value ?? "").trim();
  return s.length > 0 ? s : null;
}

export function buildSubscriptionInvoiceContent(
  input: SubscriptionInvoiceContentInput,
): SubscriptionInvoiceContent {
  const amountPaise = Number.isFinite(input.amountPaise) ? Math.trunc(input.amountPaise) : 0;
  // Defensive: the column is always 0 in this phase, but if a row ever carried
  // a value we show it truthfully as a plain amount — never labelled "GST".
  const taxPaise = Number.isFinite(input.taxPaise) ? Math.trunc(input.taxPaise) : 0;
  const totalPaise = amountPaise + taxPaise;
  const planAmountPaise = Number.isFinite(input.planAmountPaise) ? Math.trunc(input.planAmountPaise) : amountPaise;
  const extraBedAmountPaise = Number.isFinite(input.extraBedAmountPaise) ? Math.trunc(input.extraBedAmountPaise ?? 0) : 0;
  const hasExtraBeds = Boolean(input.extraBeds && input.extraBeds > 0);

  const currency = (clean(input.currency) || "INR").toUpperCase();

  return {
    brandName: "Stayo",
    docTitle: "Subscription Invoice",

    invoiceNumber: String(input.invoiceNumber || "—"),
    issueDateLabel: formatInvoiceDate(input.issuedAt),

    billTo: {
      name: clean(input.billingName) || "Account holder",
      email: clean(input.billingEmail),
      phone: clean(input.billingPhone),
      address: clean(input.billingAddress),
    },

    subscription: {
      planName: clean(input.planName) || "Stayo subscription",
      periodStartLabel: formatInvoiceDate(input.billingPeriodStart),
      periodEndLabel: formatInvoiceDate(input.billingPeriodEnd),
      extraBedsLabel: hasExtraBeds
        ? `${input.extraBeds} extra bed${input.extraBeds === 1 ? "" : "s"} @ ${formatPaiseInr(input.extraBedUnitPricePaise ?? 0)}/bed`
        : null,
    },

    payment: {
      methodLabel: paymentMethodLabel(input.paymentMethod),
      transactionReference: clean(input.transactionReference),
      currency,
    },

    summary: {
      plan: { label: "Plan", value: formatPaiseInr(planAmountPaise) },
      extraBeds: hasExtraBeds ? { label: "Extra beds", value: formatPaiseInr(extraBedAmountPaise) } : null,
      subtotal: { label: "Subtotal", value: formatPaiseInr(amountPaise) },
      tax: { label: "Tax", value: formatPaiseInr(taxPaise) },
      total: { label: "Total paid", value: formatPaiseInr(totalPaise) },
    },

    amountPaise,
    taxPaise,
    totalPaise,

    footerNote: "Stayo · Subscription billing · This is a computer-generated invoice.",
  };
}
