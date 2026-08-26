/**
 * The OVERDUE tile on the tenant profile.
 *
 * This used to be `overdue_amount > 0 ? 1 : 0` rendered under the word "days",
 * so the tile showed "1 days" for a tenant one day late and for one three
 * months late, and "0 days" for everyone else. The number is now either a real
 * count of days since the oldest still-unpaid obligation fell due, or nothing
 * at all — never a flag dressed as a duration.
 *
 * `overdue_amount` stays the authority on *whether* the tenant is overdue: it
 * comes from `FinancialReadModelService`, which is the canonical composition
 * (see CLAUDE.md — compose, don't reimplement). Due dates are used only to say
 * *how long*, and when they can't answer that, the tile shows the tone and
 * label without a number rather than guessing.
 */

export type OverdueTone = 'success' | 'warning' | 'destructive';

export interface OverdueDisplay {
  /** Days since the oldest unpaid obligation fell due, or null when unknown/not overdue. */
  days: number | null;
  unit: 'day' | 'days';
  label: string;
  tone: OverdueTone;
}

export interface OverdueInput {
  overdueAmount: number;
  outstanding: number;
  obligations: Array<Record<string, any>> | undefined | null;
  /** Injected so the calculation is testable and stable within a render. */
  today: string | Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Midnight UTC for a value, so a due date and "today" compare as whole days. */
function startOfDay(value: string | Date): number | null {
  const date = value instanceof Date ? value : new Date(String(value));
  const time = date.getTime();
  if (Number.isNaN(time)) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function isSettled(status: unknown): boolean {
  const value = String(status ?? '').toUpperCase();
  return value === 'PAID' || value === 'CANCELLED' || value === 'WAIVED';
}

/**
 * Days since the oldest unpaid obligation that is genuinely past due.
 * Returns null when no obligation qualifies or no date can be read — both mean
 * "we can't say", which the tile renders as no number.
 */
function daysSinceOldestUnpaid(
  obligations: Array<Record<string, any>> | undefined | null,
  todayStart: number,
): number | null {
  if (!Array.isArray(obligations)) return null;

  let oldest: number | null = null;
  for (const obligation of obligations) {
    if (isSettled(obligation?.status)) continue;
    const due = startOfDay(obligation?.due_date ?? obligation?.dueDate);
    if (due === null || due >= todayStart) continue;
    if (oldest === null || due < oldest) oldest = due;
  }

  if (oldest === null) return null;
  return Math.round((todayStart - oldest) / MS_PER_DAY);
}

export function toOverdueDisplay({
  overdueAmount,
  outstanding,
  obligations,
  today,
}: OverdueInput): OverdueDisplay {
  const todayStart = startOfDay(today);
  const isOverdue = Number(overdueAmount) > 0;

  if (!isOverdue) {
    const hasBalance = Number(outstanding) > 0;
    return {
      days: null,
      unit: 'days',
      label: hasBalance ? 'Not yet due' : 'Paid on time',
      tone: hasBalance ? 'warning' : 'success',
    };
  }

  const days = todayStart === null ? null : daysSinceOldestUnpaid(obligations, todayStart);

  return {
    days,
    unit: days === 1 ? 'day' : 'days',
    label: 'Needs follow-up',
    tone: 'destructive',
  };
}
