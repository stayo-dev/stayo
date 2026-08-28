/**
 * The receipt's content model — what it says, decided separately from how it
 * is drawn.
 *
 * The previous template computed every string inline while positioning it,
 * which is how several defects survived on a document the hostel hands to a
 * paying resident:
 *
 * - **A different hostel's name and email in the footer.** A retired
 *   single-hostel identity from an earlier product was hardcoded in five
 *   places — PDF title, author, monogram fallback, name fallback, and the
 *   footer — so a receipt headed "Shoeb's Mansion" was signed by an unrelated
 *   business. `scripts/check-production-branding.mjs` forbids that identity by
 *   name, but only ever scanned `apps/frontend/dist`; the backend was never
 *   looked at, which is how it survived on every receipt this system issued.
 * - **`, Hyderabad`** — a leading comma, from joining an empty street line to
 *   a city.
 * - **`TRANSACTION ID: N/A`** on a cash payment, and `Due date: N/A`. A field
 *   that does not apply is removed here, never printed as "N/A".
 * - **`Rs. 16,000`** instead of `₹16,000`, because pdf-lib's standard fonts are
 *   WinAnsi and cannot encode `₹`. Fixed in the renderer by embedding Inter,
 *   which has the glyph; this module emits the real symbol and lets the
 *   renderer's font carry it.
 * - **`SETTLEMENT BREAKDOWN` / `ALLOCATED AMOUNT` / `RECEIPT VERSION v4.0.0`** —
 *   internal vocabulary. `financial-read-model-service` is explicit that
 *   settlement-engine concepts must not reach a presentation surface.
 *
 * PURE MODULE — no pdf-lib, no I/O, no fonts. Tested directly.
 */

/** A row that is only rendered when it has a value. */
export type Field = { label: string; value: string };

export type SettlementLine = {
  label: string;
  amount: string;
  /** Deposits, maintenance and future credit read differently from rent. */
  note: string | null;
};

export type ReceiptContent = {
  /** The issuing hostel. Always from data — there is no default identity. */
  issuerName: string;
  issuerAddress: string | null;
  issuerContact: string | null;
  issuerGst: string | null;
  /** Monogram shown when no logo image resolves. */
  monogram: string;

  documentTitle: string;
  receiptNumber: string;

  /** Issued / paid / method / reference — present entries only. */
  meta: Field[];

  payeeName: string;
  payeeLines: string[];

  settlementHeading: string;
  settlement: SettlementLine[];
  totalLabel: string;
  totalAmount: string;

  /** Where the account stands afterwards. Empty when there is nothing to say. */
  position: Field[];

  verifyUrl: string | null;
  verifyHeading: string;
  verifyNote: string;

  footerNote: string;
  footerLeft: string;
  /** Platform attribution. The hostel issues the receipt; Stayo carries it. */
  footerRight: string;
};

export type ReceiptContentInput = {
  hostel_name: string;
  hostel_address: string | null;
  hostel_city: string | null;
  hostel_state: string | null;
  hostel_pincode: string | null;
  hostel_phone: string | null;
  hostel_gst: string | null;

  receipt_number: string;
  issued_at_display: string;
  payment_date_display: string;
  payment_method: string | null;
  transaction_id: string | null;
  reference_number: string | null;

  tenant_name: string;
  tenant_phone: string | null;
  tenant_email: string | null;
  room_no: string | null;
  room_floor: string | null;

  settlement_allocations: Array<{ type: string; label: string; allocated: number; rent_month_display: string | null }>;
  future_credit_allocated: number;
  total_transaction_paid: number;
  outstanding_balance_after: number;
  future_credit_balance_after: number;

  verification_url: string | null;
  footer: string | null;
};

/** `₹16,000` — Indian grouping, no paise. The symbol is real, not `Rs.`. */
export function rupees(amount: number): string {
  const value = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `₹${new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)}`;
}

/** Joins present parts only — the source of the old `, Hyderabad`. */
export function joinParts(parts: Array<string | null | undefined>, separator = ", "): string {
  return parts
    .map((part) => (part == null ? "" : String(part).trim()))
    .filter(Boolean)
    .join(separator);
}

/** Up to three initials, from whatever the hostel is actually called. */
export function monogramFor(name: string): string {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  const initials = words.map((word) => word[0]).join("").replace(/[^A-Za-z0-9]/g, "");
  return (initials || "H").slice(0, 3).toUpperCase();
}

/** A row, or nothing. Never a row containing "N/A". */
function field(label: string, value: string | null | undefined): Field | null {
  const text = value == null ? "" : String(value).trim();
  if (!text || text.toUpperCase() === "N/A") return null;
  return { label, value: text };
}

function present(fields: Array<Field | null>): Field[] {
  return fields.filter((entry): entry is Field => entry !== null);
}

/** Payment method as a person would say it, not as the column stores it. */
export function methodLabel(method: string | null | undefined): string | null {
  const raw = String(method || "").trim();
  if (!raw) return null;
  const known: Record<string, string> = {
    CASH: "Cash",
    UPI: "UPI",
    CARD: "Card",
    NETBANKING: "Net banking",
    NET_BANKING: "Net banking",
    BANK_TRANSFER: "Bank transfer",
    NEFT: "Bank transfer (NEFT)",
    IMPS: "Bank transfer (IMPS)",
    CHEQUE: "Cheque",
    ONLINE: "Online",
    RAZORPAY: "Online",
  };
  return known[raw.toUpperCase().replace(/[\s-]+/g, "_")] || raw;
}

/**
 * What one allocation settled, in plain language.
 *
 * The old template printed the engine's own words. A resident reading
 * "ALLOCATED AMOUNT" against "Security Deposit" learns nothing they did not
 * already know, and is told it in a register that belongs to an internal tool.
 */
export function settlementLabel(type: string, label: string, rentMonthDisplay: string | null): string {
  const explicit = String(label || "").trim();
  const kind = String(type || "").toUpperCase();

  if (kind === "SECURITY_DEPOSIT" || kind === "ADVANCE") return "Security deposit";
  if (kind === "MAINTENANCE") return "Maintenance";
  if (kind === "LATE_FEE") return "Late fee";
  if (kind === "RENT") return rentMonthDisplay ? `Rent — ${rentMonthDisplay}` : "Rent";

  return explicit || "Payment";
}

export function buildReceiptContent(input: ReceiptContentInput): ReceiptContent {
  const issuerName = String(input.hostel_name || "").trim() || "Your hostel";

  const settlement: SettlementLine[] = input.settlement_allocations
    .filter((allocation) => Number(allocation.allocated) > 0)
    .map((allocation) => ({
      label: settlementLabel(allocation.type, allocation.label, allocation.rent_month_display),
      amount: rupees(Number(allocation.allocated)),
      note: null,
    }));

  // Money that arrived but was not owed yet is held, not spent. Saying so on
  // the receipt is the difference between a credit and an unexplained gap.
  if (input.future_credit_allocated > 0) {
    settlement.push({
      label: "Held as credit for future rent",
      amount: rupees(input.future_credit_allocated),
      note: "Applied automatically to your next bill",
    });
  }

  return {
    issuerName,
    issuerAddress:
      joinParts([
        input.hostel_address,
        joinParts([input.hostel_city, input.hostel_state]),
        input.hostel_pincode,
      ]) || null,
    issuerContact: input.hostel_phone?.trim() || null,
    issuerGst: input.hostel_gst?.trim() || null,
    monogram: monogramFor(issuerName),

    documentTitle: "RECEIPT",
    receiptNumber: String(input.receipt_number || "").trim(),

    meta: present([
      field("Issued", input.issued_at_display),
      field("Paid on", input.payment_date_display),
      field("Method", methodLabel(input.payment_method)),
      // Cash has no transaction id. The old template printed "N/A" for it.
      field("Transaction ID", input.transaction_id),
      field("Reference", input.reference_number),
    ]),

    payeeName: String(input.tenant_name || "").trim() || "Resident",
    payeeLines: [
      joinParts(
        [
          input.room_no ? `Room ${input.room_no}` : null,
          input.room_floor ? `Floor ${input.room_floor}` : null,
        ],
        " · "
      ),
      input.tenant_phone?.trim() || "",
      input.tenant_email?.trim() || "",
    ].filter(Boolean),

    settlementHeading: "What this payment settled",
    settlement,
    totalLabel: "Total paid",
    totalAmount: rupees(input.total_transaction_paid),

    position: present([
      input.outstanding_balance_after > 0
        ? field("Still outstanding", rupees(input.outstanding_balance_after))
        : null,
      input.future_credit_balance_after > 0
        ? field("Credit in hand", rupees(input.future_credit_balance_after))
        : null,
    ]),

    verifyUrl: input.verification_url?.trim() || null,
    verifyHeading: "Verify this receipt",
    // Not "Secure HMAC" — the reader is a resident, not an engineer.
    verifyNote: "Scan to confirm this receipt is genuine",

    footerNote:
      input.footer?.trim() ||
      "Computer-generated receipt — no signature required. For any query about this payment, contact the hostel.",
    footerLeft: joinParts([issuerName, input.hostel_phone], " · "),
    footerRight: "Powered by Stayo",
  };
}
