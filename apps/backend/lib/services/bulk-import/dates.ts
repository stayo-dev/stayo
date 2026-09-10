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

  // Excel numeric date serial
  const numericDate = Number(trimmed);
  if (!isNaN(numericDate) && numericDate > 20000 && numericDate < 100000) {
    // Excel epoch is Dec 30, 1899
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + numericDate * 86400000);
    if (!isNaN(date.getTime())) {
      return date;
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

      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (!isNaN(date.getTime())) {
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
