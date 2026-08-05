/**
 * Collection queue prioritisation.
 *
 * Pure — no Prisma, no I/O, no clock of its own (`today` is always passed in),
 * so the ordering an owner sees is fully testable and reproducible.
 *
 * Two rules shape everything here:
 *
 * 1. **No magic ordering.** A score is never a bare number. Every point is
 *    attributed to a named factor with owner-readable text, so the UI can
 *    answer "why is this person first?" without anyone reading this file.
 * 2. **This module never computes money.** `outstanding` arrives already
 *    calculated by `financialService.getTenantPaymentSummary`. Obligations are
 *    the source of truth for what is owed; re-deriving it here would create a
 *    second answer that could disagree with the tenant's own screen.
 *
 * See ADR-045.
 */

/**
 * Buckets, in the order the owner works them. Ordinals are spread so a future
 * bucket can be inserted without renumbering.
 */
export const BUCKETS = {
  NEEDS_ATTENTION: { id: 'NEEDS_ATTENTION', label: 'Needs immediate attention', order: 10 },
  DUE_TODAY: { id: 'DUE_TODAY', label: 'Due today', order: 20 },
  AWAITING_REMINDER: { id: 'AWAITING_REMINDER', label: 'Waiting after reminder', order: 30 },
  DUE_SOON: { id: 'DUE_SOON', label: 'Due soon', order: 40 },
} as const;

export type BucketId = keyof typeof BUCKETS;

/** Inputs the queue already knows. Nothing here is fetched or derived by this module. */
export interface CollectionSignals {
  /** From getTenantPaymentSummary.pending_amount. Never recomputed here. */
  outstanding: number;
  /** Whole days past the oldest unpaid due date. 0 when nothing is overdue. */
  daysOverdue: number;
  /** Whole days until the nearest upcoming due date. null when already overdue. */
  daysUntilDue: number | null;
  lastPaymentAt: Date | null;
  lastReminderAt: Date | null;
  /** Reminders sent for the currently-unpaid obligations. */
  reminderCount: number;
  /** How many past obligations this tenant settled late — the repeat-issue signal. */
  previousLatePayments: number;
}

export interface PriorityFactor {
  id: string;
  /** Owner-readable, e.g. "12 days overdue". Never a field name or a flag. */
  label: string;
  points: number;
}

export interface PrioritisedItem {
  bucket: BucketId;
  score: number;
  factors: PriorityFactor[];
  /**
   * Reserved for the recommendation engine (ADR-045, not built). Kept on the
   * contract from day one so adding AI later is a value change, not a redesign
   * of this page.
   */
  recommendation: null;
}

export interface PriorityConfig {
  /** Days after a reminder during which chasing again adds nothing. */
  reminderCooldownDays: number;
  /** How far ahead "due soon" looks. */
  dueSoonWindowDays: number;
  /**
   * Beyond this many days overdue, a recent reminder **stops** deferring the
   * tenant. Caught against live data: without this, someone 11 days late who
   * was reminded yesterday was demoted below someone 12 days late, and 7 of 10
   * tenants fell into "waiting" — the queue reported almost no work while
   * ₹59,000 sat uncollected. A reminder that old has visibly not worked, so
   * the owner should be talking to them, not waiting.
   */
  reminderCooldownMaxOverdueDays: number;
}

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  reminderCooldownDays: 2,
  dueSoonWindowDays: 7,
  reminderCooldownMaxOverdueDays: 7,
};

/** Whole days between two dates, ignoring time of day. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

/**
 * Which bucket this tenant belongs in.
 *
 * The one non-obvious rule: an overdue tenant who was reminded **within the
 * cooldown** drops to "waiting after reminder" rather than staying at the top.
 * The queue exists to reduce decisions, and messaging someone again the day
 * after you already chased them is not work — it is noise. They return to
 * "needs immediate attention" the moment the cooldown lapses.
 */
export function assignBucket(signals: CollectionSignals, config: PriorityConfig, today: Date): BucketId | null {
  if (signals.outstanding <= 0) return null;

  const isOverdue = signals.daysOverdue > 0;

  // The cooldown only defers tenants who are not yet badly overdue. Past
  // `reminderCooldownMaxOverdueDays`, reminders have demonstrably failed and
  // deferring further would hide real work.
  const cooldownApplies = signals.daysOverdue <= config.reminderCooldownMaxOverdueDays;
  if (signals.lastReminderAt && cooldownApplies) {
    const sinceReminder = daysBetween(signals.lastReminderAt, today);
    if (sinceReminder >= 0 && sinceReminder < config.reminderCooldownDays) {
      return 'AWAITING_REMINDER';
    }
  }

  if (isOverdue) return 'NEEDS_ATTENTION';
  if (signals.daysUntilDue === 0) return 'DUE_TODAY';
  if (signals.daysUntilDue !== null && signals.daysUntilDue > 0 && signals.daysUntilDue <= config.dueSoonWindowDays) {
    return 'DUE_SOON';
  }

  // Owes money but nothing is due yet and nothing is overdue — not today's work.
  return null;
}

/**
 * Score orders tenants **within** a bucket; the bucket itself decides the
 * section. A single global score would let a large not-yet-due amount outrank
 * a small long-overdue one, which is the opposite of how an owner works.
 */
export function scoreSignals(signals: CollectionSignals): { score: number; factors: PriorityFactor[] } {
  const factors: PriorityFactor[] = [];

  if (signals.daysOverdue > 0) {
    // Capped: past ~2 months, longer overdue stops being the differentiator
    // and the amount should decide.
    const days = Math.min(signals.daysOverdue, 60);
    factors.push({
      id: 'overdue',
      label: `${signals.daysOverdue} day${signals.daysOverdue === 1 ? '' : 's'} overdue`,
      points: days * 2,
    });
  }

  if (signals.outstanding > 0) {
    // ₹1,000 = 1 point, capped at 50 so one very large balance cannot bury
    // every genuinely overdue tenant beneath it.
    const points = Math.min(Math.floor(signals.outstanding / 1000), 50);
    if (points > 0) {
      factors.push({
        id: 'amount',
        label: `₹${signals.outstanding.toLocaleString('en-IN')} outstanding`,
        points,
      });
    }
  }

  if (signals.previousLatePayments > 0) {
    const points = Math.min(signals.previousLatePayments * 10, 30);
    factors.push({
      id: 'repeat',
      label: `Paid late ${signals.previousLatePayments} time${signals.previousLatePayments === 1 ? '' : 's'} before`,
      points,
    });
  }

  if (signals.lastPaymentAt === null) {
    factors.push({ id: 'never_paid', label: 'Has never paid', points: 15 });
  }

  if (signals.reminderCount >= 3) {
    factors.push({
      id: 'ignored_reminders',
      label: `${signals.reminderCount} reminders, still unpaid`,
      points: 20,
    });
  }

  return { score: factors.reduce((sum, f) => sum + f.points, 0), factors };
}

export function prioritise(
  signals: CollectionSignals,
  today: Date,
  config: PriorityConfig = DEFAULT_PRIORITY_CONFIG,
): PrioritisedItem | null {
  const bucket = assignBucket(signals, config, today);
  if (!bucket) return null;
  const { score, factors } = scoreSignals(signals);
  return { bucket, score, factors, recommendation: null };
}

/**
 * Queue order: bucket first, then score, then a stable tiebreak so the list
 * doesn't reshuffle between refreshes.
 */
export function sortQueue<T extends { bucket: BucketId; score: number; tenantName: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      BUCKETS[a.bucket].order - BUCKETS[b.bucket].order ||
      b.score - a.score ||
      a.tenantName.localeCompare(b.tenantName),
  );
}
