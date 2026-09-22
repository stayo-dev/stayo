/**
 * What a tenant's payment claim may say, and how it may move.
 *
 * **PURE MODULE — no I/O.**
 *
 * A claim is evidence, never money. The ledger changes only when the owner
 * confirms one, so these rules are the entire gate between "a stranger typed
 * something into a public page" and "rent was received" — the page that
 * submits a claim needs no login, because its token arrives in a WhatsApp
 * button, and anyone holding a forwarded link can post to it.
 *
 * See `docs/superpowers/specs/2026-09-23-upi-collection-gateway-disconnect-design.md`.
 */

export const CLAIM_STATES = ["PENDING", "CONFIRMED", "REJECTED"] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];
export type ClaimAction = "CONFIRM" | "REJECT";

/** Ten lakh rupees, in paise. Above this, a claim is a typo, not a payment. */
const MAX_CLAIM_PAISE = 1_000_000_00;

/**
 * The reference as it should be stored and compared.
 *
 * Tenants paste this out of a UPI receipt screen, so it arrives with labels,
 * spaces and mixed case. Normalising once means the stored value, the
 * duplicate-UTR check and whatever the owner reads off their statement are all
 * the same string.
 */
export function normaliseUtr(raw: string): string {
  return String(raw ?? "")
    .replace(/\b(utr|ref(erence)?|txn|transaction)\b\s*(no\.?|number|id)?\s*:?/gi, "")
    .replace(/[\s-]/g, "")
    .trim()
    .toUpperCase();
}

/**
 * Whether this could be a payment reference at all.
 *
 * Deliberately loose. UPI's own UTR is 12 digits, but not every rail returns
 * exactly that, and rejecting a real reference is worse than accepting an odd
 * one: the owner checks it against their bank statement either way, and a
 * refused reference blocks a tenant who genuinely paid. The job here is only
 * to catch free text — "I paid by phonepe" — before it reaches a dashboard.
 */
export function isPlausibleUtr(utr: string): boolean {
  const value = normaliseUtr(utr);
  if (value.length < 8 || value.length > 32) return false;
  if (!/^[A-Z0-9]+$/.test(value)) return false;
  // At least some digits: a reference is a number, sometimes bank-prefixed.
  return /\d{6,}/.test(value);
}

export type ClaimSubmission = {
  utr: string;
  claimedAmountPaise: number;
};

/**
 * Whether a submitted claim may be stored — and the normalised UTR to store.
 *
 * Returns rather than throws, because every message here is shown directly to
 * a tenant on a public page and each one has to be actionable by them.
 */
export function validateClaimSubmission(
  input: ClaimSubmission,
): { error: string | null; utr: string } {
  const utr = normaliseUtr(input.utr);

  if (!isPlausibleUtr(utr)) {
    return {
      error: "Enter the UPI reference number from your payment app so the owner can match it.",
      utr,
    };
  }

  const amount = input.claimedAmountPaise;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter the amount you paid.", utr };
  }
  if (amount > MAX_CLAIM_PAISE) {
    // A public, unauthenticated form; an extra zero must not land in the
    // owner's dashboard as a lakhs-sized claim.
    return { error: "That amount looks too large. Check and enter it again.", utr };
  }

  return { error: null, utr };
}

/**
 * The state a claim moves to, or a refusal.
 *
 * Only PENDING claims can be acted on. Confirming twice would credit the same
 * rent twice, and there is no obligation-edit endpoint to undo it with —
 * obligations are audit-first, so a wrongly confirmed payment is corrected
 * through the existing correction path, never by rewinding the claim. That is
 * also why there is no CONFIRMED → REJECTED transition.
 */
export function nextClaimState(current: ClaimState, action: ClaimAction): ClaimState {
  if (current !== "PENDING") {
    throw new Error(
      `VALIDATION: This payment was already ${current.toLowerCase()} and cannot be changed`,
    );
  }
  return action === "CONFIRM" ? "CONFIRMED" : "REJECTED";
}

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/**
 * A note for the owner when the tenant paid something other than what was asked.
 *
 * Most UPI apps let the payer edit the amount on a person-to-person intent, so
 * this is **routine, not suspicious**, and the wording must not suggest the
 * tenant did anything wrong. It exists so the owner is not surprised by a
 * part-paid obligation weeks later.
 */
export function amountMismatchNote(
  requestedPaise: number,
  claimedPaise: number,
): string | null {
  if (requestedPaise === claimedPaise) return null;
  const diff = Math.abs(requestedPaise - claimedPaise);
  const direction = claimedPaise < requestedPaise ? "less" : "more";
  return `${rupees(diff)} ${direction} than the amount on the link`;
}
