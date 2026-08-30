/**
 * The arithmetic behind a day / month / year dial picker.
 *
 * A native `<input type="date">` gives an owner on a phone a calendar grid and
 * a keyboard-ish `mm/dd/yyyy` field whose format depends on the browser's
 * locale — so an Indian owner entering 5 August is shown `mm/dd/yyyy` and
 * quite reasonably types 5/8. Three dials remove the ambiguity: the month is
 * named, not numbered, and there is no order to get wrong.
 *
 * The logic that actually needs care is what happens when one dial moves:
 * 31 January is a real date, February has no 31st, and a picker that silently
 * jumps to 3 March — which is what `new Date(2026, 1, 31)` does — has changed
 * a tenancy's start date without telling anyone. Everything here is pure and
 * tested for exactly that class of problem. See ADR-146.
 */

export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Reads `YYYY-MM-DD` as a plain calendar date, never through `new Date()`. */
export function parseIso(value: string | null | undefined): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function toIso(parts: DateParts): string {
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

/** Computed, not tabled, so leap years are right without a special case. */
export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 31;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Keeps a date real when a dial moves.
 *
 * Moving the month dial from January to February while the day dial sits on
 * 31 must land on 28 (or 29), never roll forward into March. Silently changing
 * the month the owner just chose is the one thing this picker must not do.
 */
export function clampParts(parts: DateParts): DateParts {
  const month = Math.min(12, Math.max(1, parts.month));
  const day = Math.min(daysInMonth(parts.year, month), Math.max(1, parts.day));
  return { year: parts.year, month, day };
}

/** Sort key for comparing dates without constructing any. */
function order(parts: DateParts): number {
  return parts.year * 10000 + parts.month * 100 + parts.day;
}

/** Pulls a date inside `[min, max]`, both optional and both inclusive. */
export function clampToRange(
  parts: DateParts,
  min: DateParts | null,
  max: DateParts | null,
): DateParts {
  const value = clampParts(parts);
  if (min && order(value) < order(min)) return min;
  if (max && order(value) > order(max)) return max;
  return value;
}

export function buildYearOptions(min: DateParts | null, max: DateParts | null, fallbackYear: number): number[] {
  // Sensible defaults when a bound is open: a tenancy start is realistically
  // within a few decades back and a year or so ahead.
  const from = min?.year ?? fallbackYear - 30;
  const to = max?.year ?? fallbackYear + 2;
  if (to < from) return [fallbackYear];
  const years: number[] = [];
  for (let year = from; year <= to; year += 1) years.push(year);
  return years;
}

/** Months available in the chosen year, given the bounds. */
export function buildMonthOptions(year: number, min: DateParts | null, max: DateParts | null): number[] {
  const from = min && year === min.year ? min.month : 1;
  const to = max && year === max.year ? max.month : 12;
  const months: number[] = [];
  for (let month = from; month <= to; month += 1) months.push(month);
  return months.length > 0 ? months : [from];
}

/** Days available in the chosen year and month, given the bounds. */
export function buildDayOptions(
  year: number,
  month: number,
  min: DateParts | null,
  max: DateParts | null,
): number[] {
  const from = min && year === min.year && month === min.month ? min.day : 1;
  const last = daysInMonth(year, month);
  const to = max && year === max.year && month === max.month ? Math.min(max.day, last) : last;
  const days: number[] = [];
  for (let day = from; day <= to; day += 1) days.push(day);
  return days.length > 0 ? days : [from];
}

/**
 * How the chosen date reads back to the owner: "5 August 2026".
 *
 * Day-first, because that is how the date is said in the market this serves,
 * and unambiguous either way once the month is a word.
 */
export function formatDateParts(parts: DateParts | null): string {
  if (!parts) return '';
  return `${parts.day} ${MONTH_NAMES[parts.month - 1]} ${parts.year}`;
}
