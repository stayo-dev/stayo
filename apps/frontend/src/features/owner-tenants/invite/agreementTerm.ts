/**
 * "How long does this agreement run?" — the values the duration ring offers,
 * and what a given length actually means on a calendar.
 *
 * The field used to be a free-text numeric input. That asked the owner to type
 * a number whose consequence — the date the agreement ends — was left for them
 * to work out, and accepted anything they typed, including `0` and `999`. The
 * ring offers a bounded range and states the end date, which is the thing an
 * owner reasons about ("so they're with me until next July").
 *
 * All of it is pure so it can be tested directly — this app's test runner is
 * node-only and never renders a component. `DurationRing.tsx` is a thin
 * renderer over these functions plus scroll position.
 */

/** Shortest and longest agreement the ring will offer, inclusive. */
export const MIN_AGREEMENT_MONTHS = 1;
export const MAX_AGREEMENT_MONTHS = 36;

/**
 * The one-tap lengths, in the order they are shown.
 *
 * 11 earns its place: an 11-month agreement is the Indian norm precisely
 * because a 12-month one crosses the registration threshold, and it was the
 * one common answer the old free-text field made an owner type out every time.
 */
export const AGREEMENT_PRESETS = [6, 11, 12, 24] as const;

/** Every value the ring can land on, low to high. */
export const AGREEMENT_MONTH_OPTIONS: number[] = Array.from(
  { length: MAX_AGREEMENT_MONTHS - MIN_AGREEMENT_MONTHS + 1 },
  (_, i) => MIN_AGREEMENT_MONTHS + i,
);

/** Pulls any number onto the ring's range, rounding a fractional value to a whole month. */
export function clampAgreementMonths(value: number): number {
  if (!Number.isFinite(value)) return MIN_AGREEMENT_MONTHS;
  return Math.min(MAX_AGREEMENT_MONTHS, Math.max(MIN_AGREEMENT_MONTHS, Math.round(value)));
}

/**
 * The ring index for a stored value. `agreementMonths` is a string in the
 * wizard's form state and is legitimately empty until the hostel's defaults
 * land, so an unset value has to resolve to *something* — the index of the
 * shortest option, which is also where an untouched ring sits.
 */
export function indexForMonths(value: string | number): number {
  const months = clampAgreementMonths(Number(value));
  return AGREEMENT_MONTH_OPTIONS.indexOf(months);
}

/** The value at a ring index, clamped so a scroll overshoot can't read past the ends. */
export function monthsAtIndex(index: number): number {
  const bounded = Math.min(AGREEMENT_MONTH_OPTIONS.length - 1, Math.max(0, Math.round(index)));
  return AGREEMENT_MONTH_OPTIONS[bounded];
}

/**
 * Which option a scroll position has landed on.
 *
 * The ring is a horizontally scrolling strip whose items are all `itemWidth`
 * wide, padded so the first and last can still reach the centre. That padding
 * is what makes this a plain division: at `scrollLeft` 0 the first item is
 * centred, so index is simply the distance travelled in items.
 */
export function indexFromScroll(scrollLeft: number, itemWidth: number): number {
  if (!(itemWidth > 0)) return 0;
  const raw = Math.round(scrollLeft / itemWidth);
  return Math.min(AGREEMENT_MONTH_OPTIONS.length - 1, Math.max(0, raw));
}

/** Where to scroll so a given index sits under the centre marker. */
export function scrollLeftForIndex(index: number, itemWidth: number): number {
  const bounded = Math.min(AGREEMENT_MONTH_OPTIONS.length - 1, Math.max(0, index));
  return bounded * itemWidth;
}

const MONTHS_LONG = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * The last day covered by an agreement of `months` starting on `joiningDate`.
 *
 * A 12-month agreement starting 1 Aug 2026 runs to 31 Jul 2027, not 1 Aug 2027
 * — the end date is the day before the anniversary, which is what makes the
 * term exactly that many months rather than that many months and a day.
 *
 * A start date landing on a day the end month doesn't have (31 Aug + 6 months
 * would be 28 Feb + 1) is handled by building from the anniversary and
 * stepping back one day, so it clamps the way a calendar does rather than
 * rolling into the following month.
 *
 * Returns `null` when either input is missing or unusable, so the caller shows
 * nothing rather than a confidently wrong date.
 */
export function agreementEndDate(joiningDate: string, months: number): Date | null {
  if (!joiningDate || !Number.isFinite(months) || months <= 0) return null;
  const start = new Date(`${joiningDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;

  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const day = start.getUTCDate();

  // Day 0 of the following month is the last day of the target month, which is
  // how the clamp falls out without a days-in-month table.
  const lastDayOfEndMonth = new Date(Date.UTC(year, month + months + 1, 0)).getUTCDate();
  const anniversary = new Date(Date.UTC(year, month + months, Math.min(day, lastDayOfEndMonth)));
  anniversary.setUTCDate(anniversary.getUTCDate() - 1);
  return anniversary;
}

/** "Ends 31 Jul 2027" — or `null` when there is no date to state yet. */
export function describeAgreementEnd(joiningDate: string, months: number): string | null {
  const end = agreementEndDate(joiningDate, months);
  if (!end) return null;
  return `Ends ${end.getUTCDate()} ${MONTHS_LONG[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
}
