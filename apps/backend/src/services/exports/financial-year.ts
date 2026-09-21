/**
 * Periods an owner and his accountant actually use.
 *
 * **The Indian financial year runs 1 April to 31 March.** A "this year" export
 * that runs January to December is not slightly wrong for a CA — it is useless,
 * and the owner will not discover that until his accountant calls him in July.
 * That single off-by-a-quarter is the most likely way this whole feature
 * silently fails, which is why the presets live in a pure, tested module rather
 * than being assembled inline next to a date picker.
 *
 * Everything here works in IST. An owner in Guntur thinking about "last month"
 * means the month that ended in India, not in UTC.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The financial year STARTS in April (month index 3). */
const FY_START_MONTH = 3;

export type Period = {
  /**
   * Inclusive lower bound, YYYY-MM-DD in IST — or `null`, which means **no
   * lower bound**, not "the beginning of time".
   *
   * An invented start date (1970-01-01, or the epoch) would print in the
   * label, in the filename and on the report sheet as a range the owner never
   * asked for. `null` is the honest representation of "all time", and
   * `isAllTime` is the one predicate that reads it.
   */
  from: string | null;
  /** Inclusive upper bound, YYYY-MM-DD in IST. Never null — a report cannot contain the future. */
  to: string;
  /** What the document prints, e.g. "Apr 2026 – Mar 2027" or "August 2026". */
  label: string;
};

export type PeriodPresetId =
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | 'this_fy'
  | 'last_fy'
  | 'all_time';

function istParts(now: Date): { y: number; m: number; d: number } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth(), d: ist.getUTCDate() };
}

function iso(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
}

/** Last calendar day of a month — the one place an off-by-one loses a day of income. */
function lastDayOf(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-09-21" -> "21 Sep 2026". How a date is written to a person, not a database. */
export function prettyDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${d} ${MONTH[m - 1]} ${y}`;
}

/**
 * The financial year a date falls in, named by its starting calendar year.
 *
 * March 2027 belongs to FY 2026-27, not 2027-28. Keying on the start year is
 * what makes "last FY" correct in January, when the current FY began in the
 * *previous* calendar year — the case a naive `year - 1` gets wrong.
 */
export function financialYearOf(now: Date): number {
  const { y, m } = istParts(now);
  return m >= FY_START_MONTH ? y : y - 1;
}

/** "2026-27" — how an Indian accountant writes it. */
export function financialYearLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function financialYearPeriod(startYear: number): Period {
  return {
    from: iso(startYear, FY_START_MONTH, 1),
    to: iso(startYear + 1, FY_START_MONTH - 1, lastDayOf(startYear + 1, FY_START_MONTH - 1)),
    label: `Apr ${startYear} – Mar ${startYear + 1}`,
  };
}

export function monthPeriod(year: number, month: number): Period {
  // Normalise so December-minus-one rolls the year back rather than producing
  // month -1, which is how "last month" breaks in exactly one month of twelve.
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  return {
    from: iso(y, m, 1),
    to: iso(y, m, lastDayOf(y, m)),
    label: `${MONTH_LONG[m]} ${y}`,
  };
}

/** Today in IST, both ends — the shortest honest period. */
export function dayPeriod(now: Date = new Date()): Period {
  const { y, m, d } = istParts(now);
  const day = iso(y, m, d);
  return { from: day, to: day, label: prettyDate(day) };
}

/**
 * The rolling seven days ending today, inclusive.
 *
 * This is what the "This week" chip on the Expenses screen means, and it is
 * deliberately NOT the calendar week. `expense-service`'s own `week` branch
 * computes a Sunday start and an end seven days later — which on a Tuesday
 * covers four days that have not happened yet. An export and the list above it
 * disagreeing about what "this week" contains is exactly the drift this module
 * exists to prevent.
 */
export function rollingWeekPeriod(now: Date = new Date()): Period {
  const { y, m, d } = istParts(now);
  const to = iso(y, m, d);
  const from = iso(y, m, d - 6); // Date.UTC normalises a negative day across months and years.
  return { from, to, label: `${prettyDate(from)} – ${prettyDate(to)}` };
}

/**
 * Everything, up to today.
 *
 * `from` is null rather than an early sentinel date: "all time" is the absence
 * of a lower bound, and inventing one would put a date the owner never chose
 * into the label, the filename and the provenance sheet. `to` is today because
 * a report cannot contain the future.
 */
export function allTimePeriod(now: Date = new Date()): Period {
  const { y, m, d } = istParts(now);
  const to = iso(y, m, d);
  return { from: null, to, label: `All time (up to ${prettyDate(to)})` };
}

/** Where a period is honestly unbounded below. One predicate, named once. */
export function isAllTime(period: Period): boolean {
  return period.from === null;
}

/** The filename fragment: "2026-09-01-to-2026-09-30", or "all-time-to-2026-09-21". */
export function periodSlug(period: Period): string {
  return period.from === null ? `all-time-to-${period.to}` : `${period.from}-to-${period.to}`;
}

export function resolvePreset(id: PeriodPresetId, now: Date = new Date()): Period {
  const { y, m } = istParts(now);
  switch (id) {
    case 'today':
      return dayPeriod(now);
    case 'this_week':
      return rollingWeekPeriod(now);
    case 'this_month':
      return monthPeriod(y, m);
    case 'last_month':
      return monthPeriod(y, m - 1);
    case 'this_fy':
      return financialYearPeriod(financialYearOf(now));
    case 'last_fy':
      return financialYearPeriod(financialYearOf(now) - 1);
    case 'all_time':
      return allTimePeriod(now);
  }
}

/** The picker's options, current FY named so the owner can recognise it. */
export function periodPresets(now: Date = new Date()): { id: PeriodPresetId; label: string; sub: string }[] {
  const fy = financialYearOf(now);
  return [
    { id: 'today', label: 'Today', sub: resolvePreset('today', now).label },
    { id: 'this_week', label: 'This week', sub: resolvePreset('this_week', now).label },
    { id: 'this_month', label: 'This month', sub: resolvePreset('this_month', now).label },
    { id: 'last_month', label: 'Last month', sub: resolvePreset('last_month', now).label },
    { id: 'this_fy', label: `This financial year`, sub: `${financialYearLabel(fy)} · Apr ${fy} – Mar ${fy + 1}` },
    { id: 'last_fy', label: `Last financial year`, sub: `${financialYearLabel(fy - 1)} · Apr ${fy - 1} – Mar ${fy}` },
    { id: 'all_time', label: 'All time', sub: 'Everything on record' },
  ];
}

/**
 * A caller-supplied range, rejected rather than silently repaired.
 *
 * An export is handed to an accountant or a bank. Quietly swapping reversed
 * dates, or clamping a typo'd year, produces a document that looks right and
 * covers the wrong period — worse than an error the owner can see and fix.
 *
 * Either end may be omitted, because the Expenses screen's custom range
 * genuinely allows one-sided ranges ("everything up to March"). Omitting BOTH
 * is not a range at all and is refused.
 */
export function customPeriod(
  from: string | null,
  to: string | null,
  now: Date = new Date(),
): Period {
  const valid = /^\d{4}-\d{2}-\d{2}$/;
  if (!from && !to) throw new Error('VALIDATION: Give a preset, or a from and to date');
  if (from && !valid.test(from)) throw new Error('VALIDATION: Dates must be YYYY-MM-DD');
  if (to && !valid.test(to)) throw new Error('VALIDATION: Dates must be YYYY-MM-DD');
  if (from && to && from > to) throw new Error('VALIDATION: The start date is after the end date');

  // An open upper bound means "up to now", never "forever" — a report cannot
  // contain the future.
  const { y, m, d } = istParts(now);
  const end = to ?? iso(y, m, d);

  if (!from) return { from: null, to: end, label: `Up to ${prettyDate(end)}` };
  const label = from === end ? prettyDate(from) : `${prettyDate(from)} – ${prettyDate(end)}`;
  return { from, to: end, label };
}
