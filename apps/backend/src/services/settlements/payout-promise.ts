/**
 * When Stayo tells an owner their money will arrive — and whether it did.
 *
 * An owner's month is not shaped by when rent comes in. It is shaped by what
 * goes out: the building lease on the 5th, staff on the 1st, the mess supplier
 * weekly. Rent lands between the 1st and the 10th. He lives in that gap.
 *
 * So a payout date is not a status detail, it is the product. And the thing
 * that makes it worth anything is that it is the SAME date every time —
 * predictability beats speed, because a date he can plan around is worth more
 * than a fast one he cannot.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts. Keep it that way.
 */

/**
 * The commitment: two working days after capture.
 *
 * Two, not one, because every payout is still transferred by a human from a
 * real bank. One working day leaves no room for an admin who is travelling,
 * and a promise that needs everything to go right is not a promise. A kept
 * T+2 is worth more than a T+1 missed one month in six.
 */
export const PAYOUT_WORKING_DAYS = 2;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The IST calendar date of an instant, as YYYY-MM-DD. */
export function istDateOf(instant: Date | string): string {
  const ms = new Date(instant).getTime();
  if (!Number.isFinite(ms)) throw new Error("istDateOf: invalid instant");
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function isWeekend(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The date Stayo commits to, counted in working days from the IST capture day.
 *
 * Weekends are skipped because banks are shut and a promise nobody can keep is
 * worse than a later one. **Public holidays are NOT modelled** — Indian bank
 * holidays are state-specific and there is no calendar in this system to read.
 * A payout falling on Diwali will be reported late, honestly, rather than the
 * promise being quietly bent to cover it. That is the intended failure mode:
 * the counter tells the truth and someone notices.
 */
export function expectedPayoutDate(
  capturedAt: Date | string,
  workingDays: number = PAYOUT_WORKING_DAYS,
): string {
  let date = istDateOf(capturedAt);
  let remaining = Math.max(0, Math.floor(workingDays));
  while (remaining > 0) {
    date = addDays(date, 1);
    if (!isWeekend(date)) remaining -= 1;
  }
  // Capture on a Friday counts Mon+Tue and lands on Tuesday; capture on a
  // Saturday still counts from Saturday, landing Tuesday as well. Both are
  // correct: the money sat over a weekend either way.
  return date;
}

export type PromiseRecord = {
  /** NULL for items created before the promise existed — not a broken promise. */
  expectedPayoutDate: string | null;
  paidAt: Date | string | null;
};

export type PromiseScore = {
  /** Payouts that carried a promise AND have been paid. */
  judged: number;
  onTime: number;
  /** Consecutive on-time payouts, most recent first. 0 once one is late. */
  streak: number;
  allOnTime: boolean;
};

/**
 * How Stayo has actually performed against its own promise.
 *
 * A payout with no promise is skipped rather than counted as either outcome —
 * inventing a verdict for a commitment that was never made would make the
 * number meaningless in exactly the place it needs to be trusted.
 *
 * `records` must be ordered most-recent-first for `streak` to mean anything.
 */
export function scorePromises(records: PromiseRecord[]): PromiseScore {
  let judged = 0;
  let onTime = 0;
  let streak = 0;
  let streakOpen = true;

  for (const record of records ?? []) {
    if (!record.expectedPayoutDate || !record.paidAt) continue;
    judged += 1;
    const kept = istDateOf(record.paidAt) <= record.expectedPayoutDate;
    if (kept) {
      onTime += 1;
      if (streakOpen) streak += 1;
    } else {
      streakOpen = false;
    }
  }

  return { judged, onTime, streak, allOnTime: judged > 0 && onTime === judged };
}
