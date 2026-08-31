/**
 * What the Money tab's payout strip actually says.
 *
 * The backend returns facts; this picks the one sentence the owner sees. It
 * lives here, as a pure function, because the choice between "someone paid you
 * today" and "a transfer failed" is a product decision that must be testable —
 * and because this file is where the priority rule is enforced rather than
 * being an accident of JSX ordering.
 *
 * Pure module, no React. Tested directly — see `payoutState.test.ts`.
 */

export type PaidTodayEntry = { tenantId: string | null; name: string; amount: number; at: string };

export type MonthBlock = {
  monthLabel: string;
  direct: number;
  inYourBank: number;
  withStayo: number;
  throughStayo: number;
  collected: number;
  stillToCollect: number;
  tenantsOwing: number;
};

export type PayoutSummary = {
  paidToday: { count: number; total: number; tenants: PaidTodayEntry[] };
  withStayo: { total: number; expectedBy: string | null };
  failed: { total: number; count: number; reason: string | null } | null;
  lastPaid: { total: number; paidAt: string } | null;
  everOnline: boolean;
  promise: { judged: number; onTime: number; streak: number; allOnTime: boolean };
  month: MonthBlock;
  bank: { name: string | null; masked: string | null } | null;
  degraded: boolean;
};

export type StripTone = 'alert' | 'incoming' | 'settled' | 'quiet';

export type StripVoice = {
  tone: StripTone;
  headline: string;
  detail: string;
  /** Shown only when a failed transfer needs the owner to check his account. */
  action: { label: string; to: string } | null;
};

export function formatInr(amount: number): string {
  const n = Number(amount);
  return `₹${Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-IN')}`;
}

/** "Wed 27 Aug" — a real day he can hold us to, never "processing". */
export function formatPromiseDate(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  // en-IN renders "Thu, 27 Aug"; the comma makes a promise read like a
  // timestamp. Dropped so it reads as a day the owner can plan around.
  return date
    .toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace(',', '');
}

/** "21 Aug" for a past event — the weekday stops mattering once it happened. */
export function formatPastDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

/**
 * The strip's single sentence, chosen by a strict priority:
 *
 *   failed  ›  paid today  ›  money on its way  ›  all settled  ›  nothing yet
 *
 * A failure outranks every piece of good news. An owner who reads "3 tenants
 * paid you today" while ₹12,000 is stuck has been told the pleasant half of
 * the truth, and will trust the pleasant half less next time.
 */
export function stripVoice(summary: PayoutSummary | null | undefined): StripVoice {
  if (!summary) {
    return { tone: 'quiet', headline: 'Money in', detail: 'Loading your payouts…', action: null };
  }

  if (summary.failed && summary.failed.total > 0) {
    return {
      tone: 'alert',
      headline: `${formatInr(summary.failed.total)} didn't reach your bank`,
      // The reason verbatim from the admin who recorded it, then who is fixing
      // it. "We're on it" alone is a brush-off; the cause is what lets him tell
      // whether it is his bank details at fault, which only he can correct.
      detail: `${summary.failed.reason?.trim() || 'The transfer was rejected'} — your money is safe with Stayo and we're on it.`,
      // No action here. This carried a "Check payout account" button pointing
      // at `/owner/more/payout-account`, which was never a route — so at the
      // one moment an owner most needs to act, the button did nothing. Piece B
      // of the configuration redesign adds the bank-account row and restores
      // it. A missing button is honest; a dead one is not.
    };
  }

  if (summary.paidToday.count > 0) {
    const when = formatPromiseDate(summary.withStayo.expectedBy);
    const people = summary.paidToday.count === 1 ? '1 tenant paid today' : `${summary.paidToday.count} tenants paid today`;
    return {
      tone: 'incoming',
      headline: `${people} · ${formatInr(summary.paidToday.total)}`,
      detail: when
        ? `In your bank by ${when}`
        : `Paid online, so it comes to you through Stayo. You'll see the date once it's on its way.`,
      action: null,
    };
  }

  if (summary.withStayo.total > 0) {
    const when = formatPromiseDate(summary.withStayo.expectedBy);
    return {
      tone: 'incoming',
      headline: `${formatInr(summary.withStayo.total)} with Stayo`,
      detail: when ? `In your bank by ${when}` : 'Being transferred to your bank.',
      action: null,
    };
  }

  if (summary.lastPaid) {
    return {
      tone: 'settled',
      headline: "You're all settled",
      detail: `${formatInr(summary.lastPaid.total)} reached your bank on ${formatPastDate(summary.lastPaid.paidAt) ?? 'its due date'}`,
      action: null,
    };
  }

  // Never a zero-rupee box. An owner who has taken no online rent has nothing
  // wrong with his account, and a ₹0 stat tile reads like something is broken.
  return {
    tone: 'quiet',
    headline: 'No online rent yet',
    detail: summary.everOnline
      ? 'Nothing is waiting to be transferred to you.'
      : 'What your tenants pay you directly stays with you. Rent paid online comes through Stayo.',
    action: null,
  };
}

/**
 * "Last 8 payouts — all on time", or nothing at all.
 *
 * Deliberately silent below two judged payouts: a record of one is not a
 * record, and stating it would be the kind of overclaim this screen exists to
 * avoid. When a promise HAS been missed it says so — a counter that only ever
 * reports good news is not evidence of anything.
 */
export function promiseLine(promise: PayoutSummary['promise'] | null | undefined): string | null {
  if (!promise || promise.judged < 2) return null;
  if (promise.allOnTime) return `Last ${promise.judged} payouts — all on time`;
  return `${promise.onTime} of the last ${promise.judged} payouts arrived on time`;
}

/**
 * The month block's rows, in the order the money actually moves.
 *
 * Returned as data rather than rendered inline so the ordering and the
 * indentation — which is what makes it read as a reconciliation instead of a
 * list of stats — are pinned by a test.
 */
export type MonthRow = {
  key: string;
  label: string;
  amount: number;
  /** Indented rows are a *part of* the row above them, not siblings. */
  depth: 0 | 1 | 2;
  hint?: string;
};

export function monthRows(month: MonthBlock): MonthRow[] {
  return [
    { key: 'collected', label: `${month.monthLabel} so far`, amount: month.collected, depth: 0 },
    {
      key: 'direct',
      label: 'paid to you directly',
      amount: month.direct,
      depth: 1,
      hint: 'you already have this',
    },
    { key: 'throughStayo', label: 'paid through Stayo', amount: month.throughStayo, depth: 1 },
    { key: 'inYourBank', label: 'reached your bank', amount: month.inYourBank, depth: 2 },
    { key: 'withStayo', label: 'with Stayo', amount: month.withStayo, depth: 2 },
  ];
}

/**
 * Does the block actually add up?
 *
 * The backend derives these totals from their parts, so this can only fail if
 * a shape changes underneath the screen. It is here because "the numbers
 * reconcile" is the entire promise of this section, and an assertion that is
 * never checked is a comment.
 */
export function monthReconciles(month: MonthBlock): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  return (
    near(month.throughStayo, month.inYourBank + month.withStayo) &&
    near(month.collected, month.direct + month.throughStayo)
  );
}
