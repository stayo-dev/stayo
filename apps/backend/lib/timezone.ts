/**
 * 🌐 Timezone helpers
 *
 * All scheduling decisions that depend on a calendar day MUST go through
 * these helpers. Never compare `new Date().getDate()` (UTC/server-local)
 * against an owner-configured day — always resolve in the owner's timezone.
 */

/**
 * Returns the day-of-month (1–31) of `date` as observed in `timezone`.
 *
 * Uses the IANA timezone database via `Intl.DateTimeFormat`. Falls back to
 * "Asia/Kolkata" if the supplied timezone is empty or invalid, since that
 * matches the application default in `lib/preferences.ts`.
 */
export function getDayInTimezone(date: Date, timezone?: string | null): number {
  const tz = timezone && timezone.trim().length > 0 ? timezone : "Asia/Kolkata";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      day: "2-digit",
    }).format(date);
    const day = Number(parts);
    if (!Number.isFinite(day) || day < 1 || day > 31) {
      throw new Error(`Invalid day extracted: ${parts}`);
    }
    return day;
  } catch (e) {
    // Invalid timezone string — fall back to Asia/Kolkata so we never crash a cron run
    console.warn(`[timezone] Invalid timezone "${tz}", falling back to Asia/Kolkata:`, e);
    return Number(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
      }).format(date)
    );
  }
}

/**
 * Formats `date` as an Indian-locale date/time string, always evaluated in
 * IST regardless of the server process's own timezone. `toLocaleString("en-IN")`
 * alone is not enough server-side — Node's `Intl` resolves to the *process's*
 * timezone (often UTC on cloud hosts) when none is given, which silently
 * mislabels a UTC time with Indian formatting instead of actually converting
 * it. Use this anywhere a server-generated timestamp (exports, PDFs, emails)
 * is rendered for an Indian owner/tenant to read.
 */
export function formatIST(date: Date | string, options: Intl.DateTimeFormatOptions = {}): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...options });
}
