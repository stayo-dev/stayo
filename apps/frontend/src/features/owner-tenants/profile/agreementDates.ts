/**
 * Agreement start/end dates are calendar days, but the API serialises them as
 * UTC midnight (`2026-08-01T00:00:00.000Z`), and the profile printed that string
 * verbatim. These read only the `YYYY-MM-DD` part, so the day never shifts
 * with the viewer's timezone.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** `2026-08-01T00:00:00.000Z` → `2026-08-01`, the value a `<input type="date">` holds. Null when unparseable. */
export function toDateInputValue(value: unknown): string | null {
  if (value == null) return null;
  const match = DAY.exec(String(value).trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** `2026-08-01T00:00:00.000Z` → `01 Aug 2026`. `—` when empty or unparseable. */
export function formatAgreementDay(value: unknown): string {
  const day = toDateInputValue(value);
  if (!day) return '—';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
