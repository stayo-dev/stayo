/**
 * Indian phone numbers, for display and for comparison.
 *
 * The backend stores every phone in E.164 (`normalizeIndianPhone` →
 * `+91XXXXXXXXXX`), but UI code kept rendering stored numbers as
 * `+91 {phone}` — printing "+91 +918008046952". The country code is already
 * in the value; it must never be prepended by a template.
 *
 * Owners type the 10-digit local number, so an input shows `toLocalPhone()`
 * and stores back `canonicalPhone()`. Comparing canonical forms is what stops
 * "8008046952" and "+918008046952" reading as a change to the same number.
 */

/** The 10 significant digits, whatever shape the value arrives in. */
export function toLocalPhone(value: string | null | undefined): string {
  if (!value) return '';
  const digits = String(value).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * E.164, matching what the backend stores. Returns '' for anything that
 * isn't a complete Indian mobile number, so a half-typed value is never
 * mistaken for a storable one.
 */
export function canonicalPhone(value: string | null | undefined): string {
  const local = toLocalPhone(value);
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : '';
}

/** `+91 80080 46952` — grouped for reading, never double-prefixed. */
export function formatIndianPhone(value: string | null | undefined): string {
  const local = toLocalPhone(value);
  if (local.length !== 10) return String(value ?? '').trim();
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}

/** True when both values name the same number, in any notation. */
export function isSamePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  return toLocalPhone(a) === toLocalPhone(b);
}
