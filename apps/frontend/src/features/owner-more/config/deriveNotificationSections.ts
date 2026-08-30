import { type ConfigRow } from './configRows';
import type { ConfigSection } from './deriveConfigSections';

/**
 * Notifications — who hears about what, and how.
 *
 * **Why this departs from the supplied design.** The design shows a grid: each
 * event with its own WhatsApp/SMS/Email/Push chips. The data has no such thing.
 * `reminders.channels` is a single **global** set for all reminder traffic, and
 * there is no per-event gating for "payment received", "agreement ready" or
 * "move-in". Twelve chips writing three shared flags would mean tapping Email
 * on one row silently changed every other row — the worst kind of settings
 * screen.
 *
 * So channels are presented **once**, as global delivery, and each event row
 * states which channels will carry it. The design's "set it up by moment"
 * framing survives; the illusion of per-event control does not.
 */
export interface NotificationSource {
  reminders?: {
    enabled?: boolean;
    channels?: { whatsapp?: boolean; email?: boolean; in_app?: boolean; sms?: boolean };
    schedule?: { before_due_days?: number[]; after_due_days?: number[] };
    late_fee_notifications?: boolean;
    owner_daily_summary?: boolean;
  } | null;
}

export type NotificationChannelKey = 'whatsapp' | 'email' | 'in_app';

/**
 * Only channels that can actually deliver. WhatsApp goes through the Meta Cloud
 * API and email through Resend; in-app writes a `notifications` row.
 *
 * **SMS** has a stored flag but no provider, and **push** has no
 * infrastructure at all — no FCM, no APNs, no web-push anywhere in the
 * codebase. Both are omitted rather than shown as chips that do nothing.
 */
export const NOTIFICATION_CHANNELS: Array<{ key: NotificationChannelKey; label: string }> = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
  { key: 'in_app', label: 'In-app' },
];

const list = (days: number[]): string =>
  days.length <= 1
    ? String(days[0] ?? '')
    : `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`;

/** "Sent 3 days before, then 1 and 5 days after" — from the real schedule arrays. */
export function describeSchedule(schedule: {
  before_due_days?: number[];
  after_due_days?: number[];
}): string {
  const before = schedule.before_due_days ?? [];
  const after = schedule.after_due_days ?? [];

  if (before.length === 0 && after.length === 0) return 'No reminder days set';
  if (before.length > 0 && after.length === 0) {
    return `Sent ${list(before)} days before the due date`;
  }
  if (before.length === 0) return `Sent ${list(after)} days after the due date`;
  return `Sent ${list(before)} days before, then ${list(after)} days after`;
}

export function deriveNotificationSections(source: NotificationSource): ConfigSection[] {
  const reminders = source.reminders ?? {};
  const schedule = reminders.schedule ?? {};
  const remindersOn = Boolean(reminders.enabled);
  const hasDays = (schedule.before_due_days?.length ?? 0) + (schedule.after_due_days?.length ?? 0) > 0;

  return [
    {
      label: 'Tenant events',
      rows: [
        {
          key: 'rent-reminders',
          title: 'Rent due',
          detail: !remindersOn ? 'Reminders paused' : describeSchedule(schedule),
          state: !remindersOn ? 'off' : hasDays ? 'configured' : 'attention',
          route: '/owner/more/configuration/finance/billing-policy',
        },
        {
          key: 'late-fee-notifications',
          title: 'Late fee applied',
          detail: reminders.late_fee_notifications
            ? 'Tenant is told when a late fee is added'
            : 'Tenant is not notified',
          state: reminders.late_fee_notifications ? 'configured' : 'off',
          route: '/owner/more/configuration/finance/late-fees',
        },
        // These three are in the design but have no per-event gating: nothing
        // stores whether they send, so a toggle would write nowhere.
      ],
    },
    {
      label: 'Owner alerts',
      rows: [
        {
          key: 'owner-daily-summary',
          title: 'Daily summary',
          // No time is stated: the flag is a plain boolean and the hour is not
          // configurable, so "at 9 PM" would be invented.
          detail: reminders.owner_daily_summary
            ? 'Collections & occupancy, once a day'
            : 'Off',
          state: reminders.owner_daily_summary ? 'configured' : 'off',
          route: '/owner/more/configuration/notifications',
        },
      ],
    },
  ];
}

/**
 * Patch for a global reminder channel.
 *
 * Targets `reminders.channels`, never `notifications.channels` — the latter
 * exists but is read by nothing, so writing there would persist a value no send
 * path consults.
 */
export function buildChannelPatch(
  channel: NotificationChannelKey,
  next: boolean,
): Record<string, unknown> {
  return { reminders: { channels: { [channel]: next } } };
}
