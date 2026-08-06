/**
 * The two halves of an `<input type="datetime-local">` round trip.
 *
 * A `datetime-local` value carries no offset, so the browser reads it back as
 * **local** wall-clock time. Prefilling one with `toISOString().slice(0,16)`
 * therefore writes UTC and reads local: an open-and-save that changes nothing
 * moves the instant by the owner's UTC offset, and it compounds on every save
 * (−5h30m per save in IST, enough to close an open voting round outright).
 *
 * Both directions have to agree, so they live together here rather than inline
 * at the two call sites that used to disagree.
 */

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** A `Date` -> the `datetime-local` value the browser will parse back as this same instant. */
export function toLocalInputValue(d: Date): string {
  return (
    `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * A `datetime-local` value -> the instant it denotes in the user's zone.
 *
 * The components are read out and handed to the `Date` constructor rather than
 * parsed from the string, so the local-time reading is explicit rather than
 * inherited from how an engine treats an offset-less ISO string.
 */
export function fromLocalInputValue(v: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
}
