/**
 * Collection queue — client-side shapes and display helpers (ADR-045).
 *
 * All ordering, bucketing and scoring happens server-side. This module only
 * turns already-decided values into owner-readable text, and is kept pure so
 * that wording is testable and the screen stays a thin renderer.
 */

export type BucketId = 'NEEDS_ATTENTION' | 'DUE_TODAY' | 'AWAITING_REMINDER' | 'DUE_SOON' | (string & {});

export interface PriorityFactor {
  id: string;
  label: string;
  points: number;
}

export interface CollectionQueueRow {
  tenantId: string;
  tenantName: string;
  phone: string;
  hostelId: string;
  hostelName: string;
  room: string;
  outstanding: number;
  daysOverdue: number;
  daysUntilDue: number | null;
  lastPaymentAt: string | null;
  lastPaymentAmount: number;
  lastReminderAt: string | null;
  reminderCount: number;
  previousLatePayments: number;
  bucket: BucketId;
  score: number;
  factors: PriorityFactor[];
  /** Reserved for the recommendation engine — always null today. */
  recommendation: null;
}

export interface CollectionQueueGroup {
  id: BucketId;
  label: string;
  order: number;
  count: number;
  totalOutstanding: number;
  rows: CollectionQueueRow[];
}

export interface CollectionQueue {
  groups: CollectionQueueGroup[];
  totalTenants: number;
  totalOutstanding: number;
  generatedAt: string;
}

export function formatINR(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

/**
 * Compact relative date. "3 days ago" beats "02/08/2026" when the owner is
 * scanning a queue — the gap is the signal, not the calendar date.
 */
export function relativeDay(iso: string | null, today: Date = new Date()): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;

  const a = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate());
  const b = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((b - a) / 86_400_000);

  if (days < 0) return 'scheduled';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'a month ago' : `${months} months ago`;
}

/** "Last paid 3 days ago" / "Never paid". */
export function lastPaymentLabel(row: CollectionQueueRow, today?: Date): string {
  const rel = relativeDay(row.lastPaymentAt, today);
  if (!rel) return 'Never paid';
  return `Last paid ${rel}`;
}

/** "Reminded yesterday" / "No reminder sent". */
export function lastReminderLabel(row: CollectionQueueRow, today?: Date): string {
  const rel = relativeDay(row.lastReminderAt, today);
  if (!rel) return 'No reminder sent';
  return `Reminded ${rel}`;
}

/**
 * The urgency line under the name — the single most decision-relevant fact.
 * Overdue always wins over a due date, because a tenant can be both.
 */
export function urgencyLabel(row: CollectionQueueRow): string {
  if (row.daysOverdue > 0) {
    return `${row.daysOverdue} day${row.daysOverdue === 1 ? '' : 's'} overdue`;
  }
  if (row.daysUntilDue === 0) return 'Due today';
  if (row.daysUntilDue !== null && row.daysUntilDue > 0) {
    return `Due in ${row.daysUntilDue} day${row.daysUntilDue === 1 ? '' : 's'}`;
  }
  return 'Outstanding';
}

/** Where the tenant lives, for the secondary line. */
export function locationLabel(row: CollectionQueueRow): string {
  return [row.room ? `Room ${row.room}` : null, row.hostelName].filter(Boolean).join(' · ');
}

/**
 * The top reasons this tenant is placed where they are, highest-value first.
 * Capped because a queue row is scanned, not studied — the full list is in the
 * detail sheet.
 */
export function topReasons(row: CollectionQueueRow, limit = 2): string[] {
  return [...row.factors].sort((a, b) => b.points - a.points).slice(0, limit).map((f) => f.label);
}

export function phoneDigits(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '');
}

/** Same rule as search: never guess a country code we can't infer. */
export function whatsAppNumber(phone: string | null | undefined): string | null {
  const d = phoneDigits(phone);
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith('91')) return d;
  return null;
}

export type QueueViewState = 'loading' | 'error' | 'all-clear' | 'ready';

/**
 * `loading` beats everything so a slow response never flashes "All clear" at
 * an owner who actually has work waiting.
 */
export function queueViewState(input: {
  isLoading: boolean;
  isError: boolean;
  queue: CollectionQueue | undefined;
}): QueueViewState {
  if (input.isLoading) return 'loading';
  if (input.isError) return 'error';
  if (!input.queue || input.queue.totalTenants === 0) return 'all-clear';
  return 'ready';
}
