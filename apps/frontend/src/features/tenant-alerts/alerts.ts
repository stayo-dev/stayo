/**
 * The tenant's notification feed — what each one means and how it reads.
 *
 * ## Why this exists
 *
 * `notifications` had **26 live rows and no tenant screen**. Ten of them were
 * `move_out` notices addressed to residents who could never have seen one: the
 * table was written to for months, `GET /api/notifications` existed and was
 * correctly scoped to the session, and the only frontend that touched the
 * feature was the *owner's* button for sending reminders. Every message the
 * product had ever sent a tenant in-app went nowhere.
 *
 * So this is a reader, not a new system. Nothing here creates a notification;
 * it decides how an existing row is grouped, titled and coloured.
 *
 * PURE — no React, no network.
 */

export interface AlertRow {
  id: string;
  title: string;
  message: string;
  /** Free-form on the server: `move_out`, `marketing`, `lead`, `food_poll_opened`, … */
  type: string;
  is_read: boolean;
  created_at: string;
}

/**
 * The families a tenant actually distinguishes between.
 *
 * `type` is a free string written by several services, so this maps rather
 * than switches exhaustively — an unrecognised type must still render, and
 * render as something neutral rather than as an error.
 */
export type AlertKind = 'MESSAGE' | 'MONEY' | 'STAY' | 'FOOD' | 'UPDATE';

const KIND_BY_TYPE: Record<string, AlertKind> = {
  owner_message: 'MESSAGE',
  service_request_update: 'MESSAGE',
  rent_reminder: 'MONEY',
  payment_received: 'MONEY',
  payment_due: 'MONEY',
  move_out: 'STAY',
  agreement: 'STAY',
  lead: 'STAY',
  food_poll_opened: 'FOOD',
  food_menu_published: 'FOOD',
  marketing: 'UPDATE',
  platform_broadcast: 'UPDATE',
};

export function alertKind(type: string): AlertKind {
  return KIND_BY_TYPE[String(type ?? '').toLowerCase()] ?? 'UPDATE';
}

/** Unread first is wrong: a feed that reorders as you read it loses your place. */
export function sortAlerts(rows: AlertRow[]): AlertRow[] {
  return [...(rows ?? [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export function unreadCount(rows: AlertRow[] | null | undefined): number {
  return (rows ?? []).filter((row) => !row.is_read).length;
}

/**
 * Day buckets, because "when" is how someone scans a feed.
 *
 * Anything older than a week collapses into one group rather than becoming
 * thirty date headings — the exact date stops mattering long before the
 * message does.
 */
export type AlertBucket = 'Today' | 'Yesterday' | 'This week' | 'Earlier';

export function bucketFor(createdAt: string, now: Date = new Date()): AlertBucket {
  const then = new Date(createdAt);
  if (Number.isNaN(then.getTime())) return 'Earlier';

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);

  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  return 'Earlier';
}

export interface AlertGroup {
  bucket: AlertBucket;
  rows: AlertRow[];
}

/** Groups in fixed order, and empty buckets are omitted rather than shown blank. */
export function groupAlerts(rows: AlertRow[], now: Date = new Date()): AlertGroup[] {
  const order: AlertBucket[] = ['Today', 'Yesterday', 'This week', 'Earlier'];
  const sorted = sortAlerts(rows);
  return order
    .map((bucket) => ({ bucket, rows: sorted.filter((row) => bucketFor(row.created_at, now) === bucket) }))
    .filter((group) => group.rows.length > 0);
}

/** `4m`, `3h`, `2d` — a feed needs the age, not the timestamp. */
export function shortAge(createdAt: string, now: Date = new Date()): string {
  const then = new Date(createdAt).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  const days = Math.floor(seconds / 86_400);
  if (days < 7) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 365)}y`;
}
