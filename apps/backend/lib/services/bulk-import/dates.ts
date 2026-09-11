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

  const trimmed = normalizeDateText(dateStr);

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

/**
 * Strips the characters a date picks up on its way through a spreadsheet,
 * a web page and a clipboard.
 *
 * All of these render as an ordinary date — a zero-width space, a
 * left-to-right mark, an en dash where a hyphen belongs, fullwidth digits
 * from an IME, a non-breaking space. An owner looking at the cell sees
 * `2026-09-11` and we told them it "isn't a full date", which is an error
 * with no visible cause and therefore no fix. Normalising costs nothing and
 * changes no date's meaning: every substitution below maps a character to the
 * one it is already pretending to be.
 */
function normalizeDateText(value: string): string {
  return String(value)
    // Zero-width and directional marks — invisible, and fatal to a regex.
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    // Any dash that is not the ASCII hyphen.
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    // Fullwidth digits, as an IME or a pasted Asian-locale cell produces.
    .replace(/[\uFF10-\uFF19]/g, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/\uFF0F/g, "/")
    // Every flavour of space, including the non-breaking one.
    .replace(/[\s\u00A0]+/g, " ")
    .trim();
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
