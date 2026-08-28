/**
 * 🏗️ Rent Schedule Date Maths — Pure Module
 *
 * The single source of truth for month/due-date arithmetic used when
 * generating a rent schedule. Split out of agreement-rent-schedule-service.ts
 * so it can be imported by pure, no-I/O callers (e.g.
 * lib/billing/invite-settlement-preview.ts) without pulling in that file's
 * `@/lib/db` import — importing a single named export still executes the
 * whole module, and `lib/db` throws at import time in a test environment
 * with no DATABASE_URL_TEST configured.
 *
 * agreement-rent-schedule-service.ts and onboarding-financials-service.ts
 * both import from here instead of reimplementing this maths — duplicated
 * date arithmetic is exactly how a preview and the system it previews drift
 * apart. See the "Settle at Invite" plan.
 */

export function firstOfUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

export function addUtcMonths(value: Date, months: number): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
}

export function lastDayOfUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0));
}

export function dueDateForMonth(month: Date, dueDay: number): Date {
  const bounded = Math.max(1, Math.min(28, Math.trunc(Number(dueDay || 5))));
  const lastDay = lastDayOfUtcMonth(month).getUTCDate();
  return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), Math.min(bounded, lastDay)));
}
