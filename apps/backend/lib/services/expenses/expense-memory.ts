/**
 * Expense memory — the rules that turn an owner's own history into the next
 * entry's defaults.
 *
 * Pure: no Prisma, no I/O, no clock of its own. The aggregate SQL supplies
 * facts; this module decides what they mean.
 *
 * **Nothing here invents a value.** Every field an owner sees is something
 * they previously typed themselves; where history is silent, the field stays
 * null and the form stays empty rather than guessing. That is the difference
 * between "the software knows my business" and "the software made something
 * up and I have to check it every time".
 *
 * See ADR-047.
 */

export type MemoryKind = 'TITLE' | 'VENDOR';

/** Raw facts from the aggregate query. */
export interface MemoryFacts {
  kind: MemoryKind;
  /** The label the owner searches by — the expense title, or the vendor name. */
  key: string;
  occurrences: number;
  totalSpent: number;
  lastAmount: number;
  averageAmount: number;
  highestAmount: number;
  lastDate: string;
  /** Day-of-month for each past occurrence — drives the "usually around now" nudge. */
  daysOfMonth: number[];
  /** Most recent non-null values. Null means the owner never supplied one. */
  category: string | null;
  vendorName: string | null;
  paymentMethod: string | null;
  notes: string | null;
  isRecurring: boolean;
  recurringFrequency: string | null;
  /** How many of the past occurrences had a receipt attached. */
  receiptCount: number;
  /** Distinct hostels this has been recorded against. */
  hostelCount: number;
  /** Most recent ownership scope. */
  lastScope?: 'BUSINESS' | 'HOSTEL' | null;
  /** Most recent hostel ID attribution if hostel-scoped. */
  lastHostelId?: string | null;
  businessCount?: number;
  hostelScopedCount?: number;
}

export interface MemoryEntry extends MemoryFacts {
  /** Typical day of the month, when the history is consistent enough to have one. */
  typicalDayOfMonth: number | null;
  /** True when today is around the typical day and none is recorded this cycle. */
  dueAroundNow: boolean;
  /** Owner-language one-liner, e.g. "12 times · avg ₹8,200 · last 3 days ago". */
  summaryLine: string;
  /** Ranking score; higher first. */
  score: number;
}

export interface MemoryConfig {
  /** ± days around the typical day that still counts as "around now". */
  dueToleranceDays: number;
  /** Below this many occurrences, a day-of-month pattern isn't a pattern. */
  minOccurrencesForPattern: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  dueToleranceDays: 3,
  minOccurrencesForPattern: 3,
};

export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

/**
 * The day of the month this expense usually lands on.
 *
 * Uses the **median**, not the mean: a single mistimed entry (recorded on the
 * 28th when the bill is always on the 5th) would drag a mean far enough to
 * make the nudge useless, while the median shrugs it off.
 *
 * Returns null when there are too few occurrences, or when they're scattered
 * enough that no honest pattern exists — a wrong nudge is worse than none.
 */
export function typicalDayOfMonth(daysOfMonth: number[], config: MemoryConfig = DEFAULT_MEMORY_CONFIG): number | null {
  const days = daysOfMonth.filter((d) => Number.isInteger(d) && d >= 1 && d <= 31);
  if (days.length < config.minOccurrencesForPattern) return null;

  const sorted = [...days].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);

  // If most occurrences sit far from the median, there is no real pattern.
  const near = days.filter((d) => Math.abs(d - median) <= config.dueToleranceDays).length;
  if (near / days.length < 0.6) return null;

  return median;
}

/** Is `today` within tolerance of the typical day? Handles month wrap-around. */
export function isDueAround(
  typicalDay: number | null,
  today: Date,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
): boolean {
  if (typicalDay == null) return false;
  const todayDay = today.getUTCDate();
  const daysInMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();

  // A bill "due on the 30th" must still nudge on the 28th of February.
  const effectiveTypical = Math.min(typicalDay, daysInMonth);
  const direct = Math.abs(todayDay - effectiveTypical);
  const wrapped = daysInMonth - direct;
  return Math.min(direct, wrapped) <= config.dueToleranceDays;
}

/** Already recorded in the current calendar month? Then it isn't due again. */
export function recordedThisCycle(lastDate: string, today: Date): boolean {
  const last = new Date(lastDate);
  if (Number.isNaN(last.getTime())) return false;
  return last.getUTCFullYear() === today.getUTCFullYear() && last.getUTCMonth() === today.getUTCMonth();
}

export function formatINR(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

/** "3 days ago" / "yesterday" — the gap is the signal, not the calendar date. */
export function relativeDay(iso: string, today: Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'unknown';
  const days = daysBetween(then, today);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'a month ago' : `${months} months ago`;
}

export function summaryLine(facts: MemoryFacts, today: Date): string {
  const times = `${facts.occurrences} time${facts.occurrences === 1 ? '' : 's'}`;
  return `${times} · avg ${formatINR(facts.averageAmount)} · last ${relativeDay(facts.lastDate, today)}`;
}

/**
 * Ranking: frequency first, recency second.
 *
 * An owner's most-repeated expense is the one they're most likely recording
 * again, and a recency-only order would bury a weekly rice delivery under a
 * one-off repair simply because the repair happened yesterday. Something due
 * around now jumps the queue regardless.
 */
export function scoreMemory(entry: { occurrences: number; lastDate: string; dueAroundNow: boolean }, today: Date): number {
  const recencyDays = Math.max(daysBetween(new Date(entry.lastDate), today), 0);
  const frequency = Math.min(entry.occurrences, 20) * 10; // max 200
  const recency = Math.max(30 - recencyDays, 0); // max 30
  // Deliberately larger than any achievable frequency+recency total (230), so
  // "due around now" genuinely jumps the queue rather than merely nudging it.
  // Caught by test: a +100 bonus quietly lost to a frequent recent expense,
  // which would have buried the one suggestion the owner came here for.
  const DUE_NOW_BONUS = 1000;
  return frequency + recency + (entry.dueAroundNow ? DUE_NOW_BONUS : 0);
}

export function buildMemoryEntry(
  facts: MemoryFacts,
  today: Date,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
): MemoryEntry {
  const typical = typicalDayOfMonth(facts.daysOfMonth, config);
  const dueAroundNow = isDueAround(typical, today, config) && !recordedThisCycle(facts.lastDate, today);
  return {
    ...facts,
    typicalDayOfMonth: typical,
    dueAroundNow,
    summaryLine: summaryLine(facts, today),
    score: scoreMemory({ occurrences: facts.occurrences, lastDate: facts.lastDate, dueAroundNow }, today),
  };
}

/** Highest score first, then alphabetical so the list is stable between loads. */
export function sortMemory(entries: MemoryEntry[]): MemoryEntry[] {
  return [...entries].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

/**
 * The values a one-tap reuse should prefill.
 *
 * `amount` is deliberately the **last** amount, not the average: the owner is
 * about to correct it anyway, and the last real figure is a truer starting
 * point than a computed number that never actually occurred.
 */
export function reusePayload(entry: MemoryEntry): {
  title: string;
  amount: number;
  category: string | null;
  vendorName: string | null;
  paymentMethod: string | null;
  notes: string | null;
} {
  return {
    title: entry.kind === 'TITLE' ? entry.key : (entry.vendorName ?? entry.key),
    amount: entry.lastAmount,
    category: entry.category,
    vendorName: entry.vendorName ?? (entry.kind === 'VENDOR' ? entry.key : null),
    paymentMethod: entry.paymentMethod,
    notes: entry.notes,
  };
}

/**
 * Is this amount unusual for this vendor/expense?
 *
 * Historical only — compares against what the owner has actually paid before.
 * Returns null when there isn't enough history to make the claim, because
 * telling someone their second-ever purchase is "unusual" is noise.
 *
 * The threshold is deliberately generous: groceries move a few percent
 * constantly, and an alert that fires every time is one the owner learns to
 * ignore.
 */
export function priceChangeNote(
  amount: number,
  facts: Pick<MemoryFacts, 'occurrences' | 'averageAmount' | 'key'>,
  options: { minOccurrences?: number; thresholdPercent?: number } = {},
): { direction: 'up' | 'down'; percent: number; message: string } | null {
  const minOccurrences = options.minOccurrences ?? 2;
  const threshold = options.thresholdPercent ?? 15;

  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (facts.occurrences < minOccurrences) return null;
  if (!facts.averageAmount || facts.averageAmount <= 0) return null;

  const diff = ((amount - facts.averageAmount) / facts.averageAmount) * 100;
  const percent = Math.round(Math.abs(diff));
  if (percent < threshold) return null;

  const direction = diff > 0 ? 'up' : 'down';
  const usual = formatINR(facts.averageAmount);
  return {
    direction,
    percent,
    message:
      direction === 'up'
        ? `${percent}% above your usual ${usual}`
        : `${percent}% below your usual ${usual}`,
  };
}
