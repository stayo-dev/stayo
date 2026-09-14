import type { ActivityEvent } from './api';

/**
 * Decision logic for the hostel activity feed, kept apart from the components
 * that render it so it can be tested directly — the frontend suite is
 * node-only and renders nothing.
 *
 * Everything here is in **IST**, explicitly. The activity view this replaces
 * had a real bug where day grouping and times followed the viewer's device
 * clock, so an owner abroad — or anyone whose phone was set to UTC — saw a
 * payment recorded at 1 AM IST filed under the previous day. `Intl` defaults
 * to the runtime's timezone unless you name one, so every formatter below
 * names one.
 */

const IST = 'Asia/Kolkata';

/**
 * The IST calendar day a timestamp falls on, as `YYYY-MM-DD`.
 *
 * `en-CA` is what makes this work: it is the one common locale whose short
 * date format is already ISO-ordered, so no reassembly is needed.
 */
export function istDayKey(timestamp: string | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** `2:14 pm` in IST. */
export function istTimeLabel(timestamp: string | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(date)
    .toLowerCase();
}

/** `12 Sep`, or `12 Sep 2025` once the year differs from the reference day. */
function istDateLabel(timestamp: string | Date, now: Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const sameYear = istDayKey(date).slice(0, 4) === istDayKey(now).slice(0, 4);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

/** The IST day key `offset` days before the one `from` falls in. */
function shiftedDayKey(from: Date, offset: number): string {
  return istDayKey(new Date(from.getTime() + offset * 86_400_000));
}

export interface ActivityDayGroup {
  /** `YYYY-MM-DD` in IST — stable, and safe as a React key. */
  key: string;
  /** `Today`, `Yesterday`, `12 Sep`, or `12 Sep 2025`. */
  label: string;
  events: ActivityEvent[];
}

/**
 * Buckets events into IST calendar days, newest day first and newest event
 * first within each day.
 *
 * The server already sorts, but this does not assume it: a feed assembled
 * from eight tables is exactly the kind of thing that arrives one row out of
 * order after a later change, and a timeline that silently mis-orders is
 * worse than one that is slow.
 */
export function groupActivityEvents(
  events: ActivityEvent[],
  now: Date = new Date(),
): ActivityDayGroup[] {
  const todayKey = istDayKey(now);
  const yesterdayKey = shiftedDayKey(now, -1);

  const buckets = new Map<string, ActivityEvent[]>();

  for (const event of events) {
    const key = istDayKey(event.timestamp);
    // An event with an unreadable timestamp cannot be placed on a timeline;
    // dropping it beats inventing a day for it.
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(event);
    else buckets.set(key, [event]);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([key, dayEvents]) => ({
      key,
      label:
        key === todayKey
          ? 'Today'
          : key === yesterdayKey
            ? 'Yesterday'
            : istDateLabel(dayEvents[0].timestamp, now),
      events: dayEvents
        .slice()
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    }));
}

/**
 * Who did it, in the owner's terms.
 *
 * The server's actor names are already owner-facing; this only collapses the
 * ones an owner would read as themselves. `Owner` becomes `You` because the
 * only person reading this screen is the owner — and `Staff` stays distinct
 * because "someone at the desk recorded this" is a different fact.
 */
export function actorLabel(actor: { name?: string } | undefined): string {
  const name = (actor?.name || '').trim();
  if (!name) return 'System';
  if (name === 'Owner') return 'You';
  return name;
}

/** Category → the two semantic tones the cards use. */
const CATEGORY_TONES: Record<string, string> = {
  Payments: 'success',
  Expenses: 'destructive',
  Occupancy: 'primary',
  Documents: 'warning',
  Admissions: 'primary',
  'Move Outs': 'muted',
  Billing: 'primary',
  Settings: 'muted',
};

export function categoryTone(category: string): string {
  return CATEGORY_TONES[category] ?? 'muted';
}

/** Every category the feed can produce, in the order the filter row shows them. */
export const ACTIVITY_CATEGORIES = [
  'Payments',
  'Expenses',
  'Occupancy',
  'Admissions',
  'Documents',
  'Move Outs',
  'Billing',
  'Settings',
] as const;
