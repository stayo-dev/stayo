/**
 * The `RECEIPT` answer, and the unprompted confirmation that follows a payment.
 *
 * The old flow went silent at the worst possible moment: a guardian tapped a
 * payment link, paid, and WhatsApp said nothing. The thread that asked for
 * money never acknowledged receiving it. That silence is where trust in a
 * collections channel is lost — the next reminder arrives from a number that,
 * as far as the reader knows, has no idea they already paid.
 *
 * Both messages below are built from the same shape so the receipt a guardian
 * pulls up in March is word-for-word the one they were sent in February.
 *
 * Pure — no database, no provider.
 */

import { Audience, Subject, compose, lines, possessive, rupees, shortDate, signature, subjectLine } from "./voice";

export type PaymentRecord = {
  amount: number;
  paidOn: Date | string | null;
  /** "Rent — August 2026", "Security deposit". What the money was applied to. */
  towards: string | null;
  /** Human-facing payment reference, if one was issued. */
  reference: string | null;
  /** Link to the full receipt, if one can be generated. */
  receiptUrl: string | null;
  /** Method as recorded — "UPI", "Cash", "Bank transfer". */
  method: string | null;
};

export type ReceiptInput = {
  audience: Audience;
  subject: Subject;
  payment: PaymentRecord | null;
  /** Total paid across the whole stay, for context under the last payment. */
  totalPaid: number;
  /** What remains payable after this payment — states the position plainly. */
  stillDue: number;
};

function paymentBlock(payment: PaymentRecord): string {
  const on = shortDate(payment.paidOn);
  return lines(
    on
      ? `*${rupees(payment.amount)}* received on ${on}`
      : `*${rupees(payment.amount)}* received`,
    payment.towards ? `Towards: ${payment.towards}` : null,
    payment.method ? `Method: ${payment.method}` : null,
    payment.reference ? `Reference: ${payment.reference}` : null
  );
}

/** The reply to `RECEIPT`: the most recent payment, and where it leaves them. */
export function formatLastReceipt(input: ReceiptInput): string {
  if (!input.payment) {
    const whose = possessive(input.audience, input.subject);
    return compose(
      subjectLine(input.audience, input.subject),
      `No payments have been recorded against ${whose} account yet.`,
      "Send PAY to get a secure payment link.",
      signature(input.subject)
    );
  }

  const position =
    input.stillDue > 0
      ? `Still due: *${rupees(input.stillDue)}*`
      : "Nothing further is due right now.";

  return compose(
    subjectLine(input.audience, input.subject),
    "Last payment",
    paymentBlock(input.payment),
    input.payment.receiptUrl ? `Full receipt: ${input.payment.receiptUrl}` : null,
    lines(`Paid so far: ${rupees(input.totalPaid)}`, position),
    signature(input.subject)
  );
}

/**
 * Sent unprompted the moment a payment is recorded — to whoever paid, and to
 * the resident when a guardian paid on their behalf. It leads with thanks
 * because this is the one message in the whole system where thanks is the
 * accurate thing to say, and it closes by stating the new position so nobody
 * has to ask a second question.
 */
export function formatPaymentConfirmation(input: ReceiptInput): string {
  if (!input.payment) {
    throw new Error("formatPaymentConfirmation requires a payment record");
  }

  const settled = input.stillDue <= 0;
  const closing = settled
    ? input.audience === "RESIDENT"
      ? "You are fully paid up. Nothing further is due right now."
      : `${input.subject.name} is fully paid up. Nothing further is due right now.`
    : `Still due: *${rupees(input.stillDue)}*`;

  return compose(
    subjectLine(input.audience, input.subject),
    "Payment received — thank you.",
    paymentBlock(input.payment),
    input.payment.receiptUrl ? `Receipt: ${input.payment.receiptUrl}` : null,
    closing,
    signature(input.subject)
  );
}
