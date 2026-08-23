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
  /** Inclusive, YYYY-MM-DD in IST. */
  from: string;
  /** Inclusive, YYYY-MM-DD in IST. */
  to: string;
  /** What the document prints, e.g. "Apr 2026 – Mar 2027" or "August 2026". */
  label: string;
};

export type PeriodPresetId = 'this_month' | 'last_month' | 'this_fy' | 'last_fy';

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

export function resolvePreset(id: PeriodPresetId, now: Date = new Date()): Period {
  const { y, m } = istParts(now);
  switch (id) {
    case 'this_month':
      return monthPeriod(y, m);
    case 'last_month':
      return monthPeriod(y, m - 1);
    case 'this_fy':
      return financialYearPeriod(financialYearOf(now));
    case 'last_fy':
      return financialYearPeriod(financialYearOf(now) - 1);
  }
}

/** The picker's options, current FY named so the owner can recognise it. */
export function periodPresets(now: Date = new Date()): { id: PeriodPresetId; label: string; sub: string }[] {
  const fy = financialYearOf(now);
  return [
    { id: 'this_month', label: 'This month', sub: resolvePreset('this_month', now).label },
    { id: 'last_month', label: 'Last month', sub: resolvePreset('last_month', now).label },
    { id: 'this_fy', label: `This financial year`, sub: `${financialYearLabel(fy)} · Apr ${fy} – Mar ${fy + 1}` },
    { id: 'last_fy', label: `Last financial year`, sub: `${financialYearLabel(fy - 1)} · Apr ${fy - 1} – Mar ${fy}` },
  ];
}

/**
 * A caller-supplied range, rejected rather than silently repaired.
 *
 * An export is handed to an accountant or a bank. Quietly swapping reversed
 * dates, or clamping a typo'd year, produces a document that looks right and
 * covers the wrong period — worse than an error the owner can see and fix.
 */
export function customPeriod(from: string, to: string): Period {
  const valid = /^\d{4}-\d{2}-\d{2}$/;
  if (!valid.test(from) || !valid.test(to)) throw new Error('VALIDATION: Dates must be YYYY-MM-DD');
  if (from > to) throw new Error('VALIDATION: The start date is after the end date');

  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const label =
    from === to
      ? `${Number(from.slice(8))} ${MONTH[fm - 1]} ${fy}`
      : `${MONTH[fm - 1]} ${fy} – ${MONTH[tm - 1]} ${ty}`;
  return { from, to, label };
}
