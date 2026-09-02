/**
 * What to tell an owner as they type an amount the tenant has already paid.
 *
 * The Money step asked for the amount with nothing on screen saying what was
 * owed. The settlement preview — which knows, and which the wizard was already
 * fetching — was passed only to the final Verify step, so an owner typed a
 * figure blind, walked two steps forward, and only then learned whether it was
 * acceptable. When it was not, the wizard refused the invite outright at the
 * last screen.
 *
 * Both of the situations this feature exists for need the anchor *while
 * typing*: a deposit taken at the door is checked against the deposit owed,
 * and a tenant five months into a year is settled against arrears the owner
 * cannot compute in their head.
 *
 * Pure so the wording and the boundaries can be asserted without rendering —
 * the amounts come from the backend's own plan and are never recomputed here.
 */

export type PaidAmountState = 'unknown' | 'none' | 'partial' | 'exact' | 'over';

export interface PaidAmountGuidance {
  state: PaidAmountState;
  /** What is owed in total, or null before the preview has answered. */
  owedAmount: number | null;
  /** "₹15,000 owed today" — the anchor shown next to the field. */
  owedLabel: string | null;
  /** What typing this amount means, in the owner's terms. */
  message: string | null;
  /** Fills the field from a single tap. Null when there is nothing to fill. */
  fillAmount: number | null;
  /**
   * True when the amount exceeds what is owed. The server refuses this, so
   * saying it here — beside the field that caused it — is the difference
   * between a correction and a dead end three screens later.
   */
  isBlocking: boolean;
}

export function formatRupees(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

export function paidAmountGuidance(
  enteredAmount: number | string | null | undefined,
  totalOutstanding: number | null | undefined,
): PaidAmountGuidance {
  const owed = typeof totalOutstanding === 'number' && Number.isFinite(totalOutstanding) ? totalOutstanding : null;

  // Before the preview answers there is nothing honest to say. Guessing a
  // figure here would be worse than silence: it is money.
  if (owed === null) {
    return { state: 'unknown', owedAmount: null, owedLabel: null, message: null, fillAmount: null, isBlocking: false };
  }

  const owedLabel = owed > 0 ? `${formatRupees(owed)} owed today` : 'Nothing is owed yet';
  const fillAmount = owed > 0 ? Math.round(owed) : null;

  const entered = Number(enteredAmount);
  const paid = Number.isFinite(entered) && entered > 0 ? entered : 0;

  if (paid === 0) {
    return { state: 'none', owedAmount: owed, owedLabel, message: null, fillAmount, isBlocking: false };
  }

  // A rupee of tolerance, matching the server's own comparison, so a rounded
  // display value never reads as an overpayment.
  if (paid > owed + 0.01) {
    return {
      state: 'over',
      owedAmount: owed,
      owedLabel,
      message:
        owed > 0
          ? `That is ${formatRupees(paid - owed)} more than is owed. Record ${formatRupees(owed)} or less.`
          : 'Nothing is owed yet, so there is nothing to record against.',
      fillAmount,
      isBlocking: true,
    };
  }

  if (paid >= owed - 0.01) {
    return {
      state: 'exact',
      owedAmount: owed,
      owedLabel,
      message: 'Settles everything owed today.',
      fillAmount,
      isBlocking: false,
    };
  }

  return {
    state: 'partial',
    owedAmount: owed,
    owedLabel,
    message: `${formatRupees(owed - paid)} will still be owed.`,
    fillAmount,
    isBlocking: false,
  };
}
