/**
 * How long a tenant has been overdue, said in the unit it is actually measured in.
 *
 * This exists because the number was wrong by a factor of thirty in production.
 * The API's `overdue_days` — days since the OLDEST unpaid obligation's due date —
 * was mapped into a field called `overdueMonths`, and the row that rendered it
 * dutifully multiplied by 30. A tenant 53 days late was shown as "1590d overdue".
 *
 * The unit now lives in the name, in the argument, and in this file's tests, so
 * the next person to touch it cannot re-introduce the conversion that was never
 * needed. Pure module, no React — the frontend suite is node-only, and a rule
 * that can only be checked by looking at a screen is a rule that rots.
 */

/** The red badge next to a tenant's hostel name. */
export function overdueBadgeLabel(overdueDays: number): string {
  // Defensive: the row is only rendered for overdue tenants, but a negative or
  // fractional day count must never reach the screen as "-3d" or "52.4d".
  const days = Math.max(0, Math.floor(overdueDays || 0));
  return `${days}d overdue`;
}
