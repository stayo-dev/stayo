/**
 * Daily-collection series for the Money tab's cashflow card.
 *
 * `dashboardService.getCashflow()` already unwraps the response envelope and
 * returns `{ daily_collection, ... }`. The hook used to read
 * `result.data.daily_collection` — one level too deep — so every day summed
 * to ₹0 regardless of what had been collected.
 */

export interface CashflowDailyRow {
  date: string;
  amount: number | string;
}

/** What `dashboardService.getCashflow()` resolves to. */
export interface CashflowResult {
  daily_collection?: CashflowDailyRow[];
}

/** The last `n` calendar days in the viewer's timezone, `YYYY-MM-DD`, oldest first. */
export function lastNDays(n: number, now: Date = new Date()): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    // Local parts, not toISOString(): in IST that is still yesterday until 05:30.
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    days.push(`${d.getFullYear()}-${mm}-${dd}`);
  }
  return days;
}

/** Sums every hostel's daily collections onto `days`. Days with no payment are 0. */
export function sumDailyCollections(
  days: string[],
  results: Array<CashflowResult | null | undefined>,
): Array<{ date: string; amount: number }> {
  const byDate = new Map<string, number>(days.map((day) => [day, 0]));
  for (const result of results) {
    for (const row of result?.daily_collection ?? []) {
      const key = String(row.date ?? '').slice(0, 10);
      if (byDate.has(key)) byDate.set(key, (byDate.get(key) ?? 0) + (Number(row.amount) || 0));
    }
  }
  return days.map((date) => ({ date, amount: byDate.get(date) ?? 0 }));
}
