/**
 * The state machine for a settlement item — money leaving Stayo's bank account
 * and arriving in an owner's.
 *
 *   PENDING ──start──> PROCESSING ──paid──> PAID (terminal)
 *                          │
 *                          └──fail──> FAILED ──paid──> PAID
 *
 * PAID is terminal on purpose. A mistake is corrected by a compensating
 * record, never by mutating history: the transfer already happened in a real
 * bank, and rewriting our copy of it would make our ledger disagree with the
 * statement it is supposed to be reconcilable against.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export type GuardResult = { ok: true } | { ok: false; reason: string };

export const ITEM_STATUSES = [
  "PENDING",
  "PROCESSING",
  "PAID",
  "FAILED",
  "CANCELLED",
] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Methods an admin can actually make a transfer by. */
export const PAYOUT_METHODS = ["BANK_TRANSFER", "UPI", "IMPS", "NEFT", "RTGS"] as const;

export function canStart(item: { status: string }): GuardResult {
  if (item.status === "PENDING") return { ok: true };
  return {
    ok: false,
    reason: `This payout is ${item.status.toLowerCase()} — only a pending payout can be started.`,
  };
}

/**
 * Paying is allowed only from PROCESSING (or a retry after FAILED).
 *
 * The two-step exists so nobody pays from a list view by mis-tap — the design
 * makes "start payout" a separate, deliberate act before the confirmation
 * screen appears. Permitting PENDING → PAID would quietly remove that.
 */
export function canMarkPaid(item: { status: string }): GuardResult {
  if (item.status === "PROCESSING" || item.status === "FAILED") return { ok: true };
  if (item.status === "PAID") {
    return { ok: false, reason: "This payout has already been paid and cannot be paid again." };
  }
  return {
    ok: false,
    reason: "Start the payout first — a payout is confirmed from processing, not from the list.",
  };
}

export function canMarkFailed(item: { status: string }): GuardResult {
  if (item.status === "PROCESSING") return { ok: true };
  if (item.status === "PAID") {
    return { ok: false, reason: "This payout is already paid; it cannot be marked failed." };
  }
  return { ok: false, reason: "Only a payout in progress can be marked failed." };
}

export type PayoutInput = { method?: string | null; reference?: string | null };
export type PayoutValid = { ok: true; method: string; reference: string };

/**
 * Both fields are mandatory. A payout with no reference cannot be matched
 * against a bank statement later, and reconciliation is the entire reason we
 * record the transfer rather than just flipping a status.
 */
export function validatePayout(input: PayoutInput): PayoutValid | { ok: false; reason: string } {
  const method = String(input.method ?? "").trim().toUpperCase();
  const reference = String(input.reference ?? "").trim();

  if (!(PAYOUT_METHODS as readonly string[]).includes(method)) {
    return {
      ok: false,
      reason: `Choose how the money was sent: ${PAYOUT_METHODS.join(", ")}.`,
    };
  }

  if (!reference) {
    return {
      ok: false,
      reason: "Enter the UTR or reference from the transfer — without it this payout cannot be reconciled later.",
    };
  }

  return { ok: true, method, reference };
}
