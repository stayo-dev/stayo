/**
 * Subscription invoice records (ADR-172, Phase 2).
 *
 * A `subscription_invoices` row is created when a payment is APPROVED — it is
 * the financial document for that money. NO GST / tax: `tax_paise` is always 0
 * (the column is reserved for a future GST-registered flow, ADR-172).
 *
 * This domain never touches the tenant-rent invoice/receipt tables.
 */
import crypto from "crypto";
import { CURRENCY } from "./subscription-rules";

type CreateInvoiceInput = {
  ownerId: string;
  subscriptionId: string;
  paymentId: string;
  /** Total charged — must equal `planAmountPaise + extraBedAmountPaise + tax (always 0)`. */
  amountPaise: number;
  /** Extra beds this invoice covers (business rules, 2026-09-10). 0 when none. */
  extraBeds?: number;
  /**
   * Invoice breakdown (Phase 6.6, recurring extra-bed billing). `planAmountPaise`
   * is the plan-only portion of `amountPaise`; `extraBedAmountPaise` is what was
   * actually charged for extra beds THIS invoice (the incremental beds for a
   * same-plan top-up, the full requested count otherwise — never re-derived
   * here, always passed in already computed). `extraBedUnitPricePaise` is the
   * per-bed price snapshotted at this moment, so a later plan price edit can
   * never change what an issued invoice says it charged. Both default to 0 /
   * null so existing callers (tests exercising only `amountPaise`) don't need
   * to pass them, but every real call site in `subscription-payment-service.ts`
   * does.
   */
  planAmountPaise?: number;
  extraBedUnitPricePaise?: number | null;
  extraBedAmountPaise?: number;
  paymentMethod: string;
  transactionReference: string | null;
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
  notes?: string | null;
};

/** `SUB-2026-A1B2C3D4E5` — unique enough; the DB `invoice_number` UNIQUE index is the backstop. */
export function makeInvoiceNumber(now = new Date()): string {
  return `SUB-${now.getUTCFullYear()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

/**
 * Create the invoice for an approved payment. Must run inside the same
 * transaction as the payment approval + subscription update so a partial
 * failure never leaves "payment approved, no invoice".
 */
export async function createInvoiceForApprovedPayment(tx: any, input: CreateInvoiceInput) {
  const amountPaise = Math.trunc(input.amountPaise);
  const extraBedAmountPaise = Math.max(0, Math.trunc(input.extraBedAmountPaise ?? 0));
  // The plan portion is never independently trusted from a caller-supplied
  // number — it is always the total minus the (fully server-computed)
  // extra-bed amount, so the two columns reconcile against `amount_paise` by
  // construction, not by hoping both inputs happen to agree.
  const planAmountPaise =
    input.planAmountPaise !== undefined ? Math.trunc(input.planAmountPaise) : amountPaise - extraBedAmountPaise;
  const extraBeds = Math.max(0, Math.trunc(input.extraBeds ?? 0));

  if (planAmountPaise + extraBedAmountPaise !== amountPaise) {
    // A caller-supplied planAmountPaise that doesn't reconcile is a bug in
    // the caller (subscription-payment-service.ts), not a runtime user error
    // — fail loudly rather than silently issue an invoice whose line items
    // don't add up.
    throw new Error(
      `Invoice breakdown does not reconcile: plan (${planAmountPaise}) + extra beds (${extraBedAmountPaise}) !== total (${amountPaise}).`,
    );
  }

  return tx.subscription_invoices.create({
    data: {
      owner_id: input.ownerId,
      subscription_id: input.subscriptionId,
      payment_id: input.paymentId,
      invoice_number: makeInvoiceNumber(),
      billing_period_start: input.billingPeriodStart,
      billing_period_end: input.billingPeriodEnd,
      amount_paise: amountPaise,
      extra_beds: extraBeds,
      plan_amount_paise: planAmountPaise,
      extra_bed_unit_price_paise: extraBeds > 0 ? (input.extraBedUnitPricePaise ?? null) : null,
      extra_bed_amount_paise: extraBedAmountPaise,
      tax_paise: 0, // Stayo is not GST-registered — reserved, always 0.
      currency: CURRENCY,
      payment_method: input.paymentMethod,
      transaction_reference: input.transactionReference,
      notes: input.notes ?? null,
    },
  });
}
