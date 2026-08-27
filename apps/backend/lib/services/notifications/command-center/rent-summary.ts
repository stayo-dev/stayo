/**
 * The `RENT` answer — one message that replaces BAL, BALANCE, DUES and STATUS.
 *
 * Those four commands read the same obligations and printed four different
 * shapes of the same truth, and two of them disagreed outright: `DUES` summed
 * every outstanding item into a "Total Due", while `PAY` offered a link for
 * only the oldest one. A guardian saw ₹24,000 and then ₹8,000 within seconds,
 * with nothing explaining the gap. This message states one number, says what
 * it covers, and that number is the one `PAY` will charge.
 *
 * Pure — no database, no provider. Tested directly; see
 * `tests/whatsapp-command-center-rent-summary.test.ts`.
 */

import { Audience, Subject, compose, lines, possessive, rupees, shortDate, signature, subjectLine } from "./voice";

export type RentComponent = {
  /** "Rent — August 2026", "Security deposit", "Maintenance". */
  label: string;
  amount: number;
  dueDate: Date | string | null;
  overdueDays: number;
};

export type RentSummaryInput = {
  audience: Audience;
  subject: Subject;
  /** Everything payable right now. This is exactly what `PAY` will charge. */
  payableNow: number;
  /** The portion of `payableNow` already past its due date. */
  overdueAmount: number;
  /** The portion of `payableNow` that is late fee rather than rent. */
  lateFeesDue: number;
  /** Days past due on the oldest overdue item. 0 when nothing is overdue. */
  overdueDays: number;
  /** What `payableNow` is made of, oldest first. */
  components: RentComponent[];
  /** The next bill that has not been raised yet, if one is scheduled. */
  nextDue: { amount: number | null; date: Date | string | null } | null;
  /** Position in the agreed instalment schedule, when the tenant is on one. */
  instalment: { sequence: number; total: number } | null;
  /** Contract fully discharged — nothing now, nothing later. */
  fullySettled: boolean;
};

/** The headline: one sentence, stating the situation without softening it. */
function verdict(input: RentSummaryInput): string {
  const whose = possessive(input.audience, input.subject);
  const Whose = whose.charAt(0).toUpperCase() + whose.slice(1);

  if (input.fullySettled) {
    return input.audience === "RESIDENT"
      ? "Your account is fully settled. Nothing is outstanding."
      : `${Whose} account is fully settled. Nothing is outstanding.`;
  }

  if (input.payableNow <= 0) {
    return "Nothing is due right now.";
  }

  if (input.overdueAmount > 0) {
    return `${Whose} rent is *overdue*.`;
  }

  return `${Whose} rent is due.`;
}

/** The amount, and — always — what it is made of. A bare total invites a phone call. */
function amountBlock(input: RentSummaryInput): string | null {
  if (input.payableNow <= 0) return null;

  const head =
    input.overdueDays > 0
      ? `*${rupees(input.payableNow)}* — ${input.overdueDays} ${input.overdueDays === 1 ? "day" : "days"} late`
      : `*${rupees(input.payableNow)}* due`;

  // One component needs no itemisation; several always do, because the reader
  // is about to be asked to pay their sum in a single tap.
  const itemised =
    input.components.length > 1
      ? input.components.map((component) => {
          const on = shortDate(component.dueDate);
          return `• ${component.label} — ${rupees(component.amount)}${on ? ` (due ${on})` : ""}`;
        })
      : [];

  const lateFee =
    input.lateFeesDue > 0 ? `Includes ${rupees(input.lateFeesDue)} late fee.` : null;

  return lines(head, ...itemised, lateFee);
}

/** Where they are in the plan, and what lands next. Both are forward-looking. */
function aheadBlock(input: RentSummaryInput): string | null {
  const parts: string[] = [];

  if (input.instalment && input.instalment.total > 0) {
    parts.push(`Instalment ${input.instalment.sequence} of ${input.instalment.total}`);
  }

  const nextDate = shortDate(input.nextDue?.date);
  if (nextDate) {
    const amount = input.nextDue?.amount;
    parts.push(
      amount && amount > 0 ? `Next: ${rupees(amount)} on ${nextDate}` : `Next bill: ${nextDate}`
    );
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

/**
 * Build the full `RENT` reply.
 *
 * Deliberately absent, versus the message this replaces: the `███░░░ 62%`
 * progress bar (which measured paid ÷ billed — a vanity ratio, not instalment
 * progress), the "Lifetime Summary" (irrelevant to whether to pay today), and
 * the `━━ Section ━━` rules that cost four lines a screen.
 */
export function formatRentSummary(input: RentSummaryInput): string {
  return compose(
    subjectLine(input.audience, input.subject),
    verdict(input),
    amountBlock(input),
    aheadBlock(input),
    signature(input.subject)
  );
}
