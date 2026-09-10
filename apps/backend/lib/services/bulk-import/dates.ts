/**
 * Joining dates from an owner's spreadsheet.
 *
 * Slash and dash dates are read as DD/MM/YYYY — the Indian format, and the one
 * every owner-facing message asks for. ISO `YYYY-MM-DD` is still accepted
 * because Excel and our own CSV export emit it, and Excel date cells arrive as
 * numeric serials.
 */

export function parseImportDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  const trimmed = String(dateStr).trim();

  // Excel numeric date serial (a date cell read with `raw: true`).
  const numericDate = Number(trimmed);
  if (!isNaN(numericDate) && numericDate > 20000 && numericDate < 100000) {
    // Excel epoch is 30 Dec 1899. Compute the calendar day in UTC, then build
    // a *local* midnight from it, so the date is the same day in every
    // timezone and `formatImportDate` (local getters) round-trips it.
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.floor(numericDate) * 86400000);
    if (!isNaN(utc.getTime())) {
      return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
    }
  }

  const formats = [
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/,
    /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/,
  ];

  for (const format of formats) {
    const match = trimmed.match(format);
    if (match) {
      let year, month, day;
      if (format === formats[0]) {
        [, year, month, day] = match;
      } else {
        [, day, month, year] = match;
      }

      if (year.length === 2) {
        year = "20" + year; // Convert "26" to "2026"
      }

      const y = parseInt(year);
      const m = parseInt(month);
      const d = parseInt(day);
      const date = new Date(y, m - 1, d);
      // The Date constructor silently rolls impossible dates over —
      // 31/02/2026 becomes 3 March, and a US-style 12/25/2025 (month 25)
      // becomes January 2027. Accept only a date that survives the round
      // trip unchanged.
      if (
        !isNaN(date.getTime()) &&
        date.getFullYear() === y &&
        date.getMonth() === m - 1 &&
        date.getDate() === d
      ) {
        return date;
      }
    }
  }

  // No permissive `new Date(trimmed)` fallback. It accepts "May", "next
  // monday" and other junk, inventing a joining date — which becomes wrong
  // back-rent, which becomes wrong money. Only the explicit formats above
  // and the Excel serial branch are trusted.
  return null;
}

/** Storage form, `YYYY-MM-DD`. Not for display — owners see DD/MM/YYYY. */
export function formatImportDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Whole calendar months between two dates — used to cap backfill at 24. */
export function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}
