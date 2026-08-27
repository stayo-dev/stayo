/**
 * When a guardian is told about rent.
 *
 * The rule this replaces was one line — `daysOverdue >= 3` — and it had a
 * consequence nobody chose: **every message a guardian ever received was a
 * complaint.** They were contacted for the first time only once the money was
 * three days late, so the relationship opened in arrears and stayed there. A
 * parent who would happily have paid on the due date was never given the
 * chance, and then heard from us in a tone reserved for people who had not.
 *
 * The purpose of this channel is collecting rent. The message that actually
 * collects it is "due in three days, here is the link" — sent to the person
 * who holds the money. So a guardian now gets:
 *
 *   • a heads-up while the bill is still upcoming,
 *   • the due-day reminder,
 *   • and every overdue reminder from the first day, not the third.
 *
 * Pure and exported so the rule is testable on its own, rather than being an
 * inline comparison buried in a send loop.
 */

/** How many days before the due date a guardian gets the heads-up. */
export const GUARDIAN_HEADS_UP_DAYS = 3;

export type GuardianReminderDecision = {
  notify: boolean;
  /** Why — carried into logs so a "why did/didn't they get this" is answerable. */
  reason:
    | "HEADS_UP"
    | "DUE_TODAY"
    | "OVERDUE"
    | "TOO_EARLY"
    | "NO_GUARDIAN_PHONE"
    | "SAME_AS_RESIDENT";
};

/**
 * `daysOverdue` follows the convention the reminder pipeline already uses:
 * negative means "due in N days", 0 means today, positive means late.
 */
export function decideGuardianReminder(input: {
  daysOverdue: number;
  guardianPhone: string | null | undefined;
  residentPhone: string;
  /** Compares normalised digits — the schema stores phones inconsistently. */
  normalise: (phone: string) => string;
}): GuardianReminderDecision {
  const { daysOverdue, guardianPhone, residentPhone, normalise } = input;

  if (!guardianPhone || !String(guardianPhone).trim()) {
    return { notify: false, reason: "NO_GUARDIAN_PHONE" };
  }

  // One handset listed in both fields must not receive the same reminder
  // twice. Two identical messages seconds apart reads as a malfunction, and
  // it is the fastest way to get a WhatsApp number reported as spam.
  if (normalise(guardianPhone) === normalise(residentPhone)) {
    return { notify: false, reason: "SAME_AS_RESIDENT" };
  }

  if (daysOverdue > 0) return { notify: true, reason: "OVERDUE" };
  if (daysOverdue === 0) return { notify: true, reason: "DUE_TODAY" };

  const daysUntilDue = Math.abs(daysOverdue);
  return daysUntilDue <= GUARDIAN_HEADS_UP_DAYS
    ? { notify: true, reason: "HEADS_UP" }
    : { notify: false, reason: "TOO_EARLY" };
}
