/**
 * Date-of-birth logic for the Identity screen.
 *
 * The field was a bare `<input type="date">` with
 * `[&::-webkit-calendar-picker-indicator]:opacity-0` — the picker affordance
 * was hidden, so it rendered as a dead-looking `mm/dd/yyyy` with nothing to
 * tap. It also showed month-first, which is wrong for an Indian product.
 *
 * A birth date is a bad fit for a calendar anyway: today's month is never the
 * answer, so a month-paging picker starts ~240 taps from where you need to be.
 * Three columns — day, month, year — reach any date in three gestures, which is
 * why almost every good signup flow uses them.
 *
 * All of this is pure so it can be tested; `apps/frontend` has no jsdom, so the
 * component stays a renderer over these functions.
 */

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * Age bounds for a hostel resident. The floor exists because a minor cannot
 * sign a residency agreement; the ceiling only keeps the year column a sane
 * length. Both are generous — they reject typos, not people.
 */
export const MIN_AGE = 15;
export const MAX_AGE = 100;

export type DateParts = { day: number; month: number; year: number };

/** `YYYY-MM-DD`, the format the backend and `<input type="date">` both use. */
export function toISODate(parts: DateParts): string {
  const mm = String(parts.month).padStart(2, '0');
  const dd = String(parts.day).padStart(2, '0');
  return `${parts.year}-${mm}-${dd}`;
}

/**
 * Parse `YYYY-MM-DD` without going through `new Date()`, which would apply the
 * viewer's timezone and can shift a date across a day boundary — the classic
 * "birthday is one day early west of UTC" bug.
 */
export function parseISODate(value: unknown): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(month, year)) return null;
  return { day, month, year };
}

/** Leap years included, so 29 February is selectable in the years it exists. */
export function daysInMonth(month: number, year: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Keep a selection valid while the user is still changing it.
 *
 * Picking 31 January and then switching to February must not produce 31
 * February. Clamping to the last valid day is less surprising than silently
 * jumping into March, and less annoying than refusing the month change.
 */
export function clampToMonth(parts: DateParts): DateParts {
  const max = daysInMonth(parts.month, parts.year);
  return { ...parts, day: Math.min(parts.day, max) };
}

/** Completed years as of `today`, i.e. the number a person would say out loud. */
export function ageOn(parts: DateParts, today: Date): number {
  let age = today.getFullYear() - parts.year;
  const monthDiff = today.getMonth() + 1 - parts.month;
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < parts.day)) age -= 1;
  return age;
}

/** Newest year first — a resident is far likelier to be 19 than 60. */
export function selectableYears(today: Date): number[] {
  const newest = today.getFullYear() - MIN_AGE;
  const oldest = today.getFullYear() - MAX_AGE;
  const years: number[] = [];
  for (let year = newest; year >= oldest; year -= 1) years.push(year);
  return years;
}

/**
 * Where the picker should open when nothing has been chosen.
 *
 * Deliberately not today: opening on the current year means every single user
 * scrolls. Most hostel residents are students, so the median is around 20 —
 * starting there puts the answer within a nudge for the common case.
 */
export const TYPICAL_RESIDENT_AGE = 20;

export function defaultSelection(today: Date): DateParts {
  return { day: 1, month: 1, year: today.getFullYear() - TYPICAL_RESIDENT_AGE };
}

/**
 * Deliberately one flat shape rather than a discriminated union: this project's
 * tsconfig is not strict, so narrowing on an `ok: true | false` literal does not
 * work at call sites and every consumer would need a cast.
 */
export type DobValidation = { ok: boolean; iso: string; age: number; message: string };

function invalid(message: string): DobValidation {
  return { ok: false, iso: '', age: 0, message };
}

/** The single rule both the field and its submit gate consult. */
export function validateDateOfBirth(parts: DateParts | null, today: Date): DobValidation {
  if (!parts) return invalid('Select your date of birth');
  if (parts.day > daysInMonth(parts.month, parts.year)) {
    return invalid(`${MONTHS[parts.month - 1]} ${parts.year} has no day ${parts.day}`);
  }
  const age = ageOn(parts, today);
  if (age < 0) return invalid('That date is in the future');
  if (age < MIN_AGE) return invalid(`You must be at least ${MIN_AGE} to register a stay`);
  if (age > MAX_AGE) return invalid('Please check the year');
  return { ok: true, iso: toISODate(parts), age, message: '' };
}

/** `14 Mar 2004` — day-first, and unambiguous in a way `03/14/04` is not. */
export function formatDisplayDate(parts: DateParts | null): string {
  if (!parts) return '';
  return `${parts.day} ${MONTHS[parts.month - 1].slice(0, 3)} ${parts.year}`;
}
