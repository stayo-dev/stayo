import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_CHANNELS,
  buildChannelPatch,
  deriveNotificationSections,
  describeSchedule,
  type NotificationSource,
} from './deriveNotificationSections';

/**
 * The supplied design sets notifications up "by moment, not by channel": a grid
 * of events, each with its own WhatsApp/SMS/Email/Push chips.
 *
 * The data does not work that way. `reminders.channels` is **global** — one set
 * of switches for all reminder traffic — and there is no per-event gating for
 * "payment received", "agreement ready" or "move-in". Rendering the grid as
 * drawn would give an owner twelve chips that all write the same three flags,
 * so tapping Email on one row would silently change every other row.
 *
 * These tests pin the honest alternative: channels are presented once, as
 * global delivery, and only events that genuinely exist get a row.
 */
const source = (overrides: Partial<NotificationSource> = {}): NotificationSource => ({
  reminders: {
    enabled: true,
    channels: { whatsapp: true, email: true, in_app: true, sms: false },
    schedule: { before_due_days: [3], after_due_days: [1, 5] },
    late_fee_notifications: true,
    owner_daily_summary: false,
  },
  ...overrides,
});

const find = (s: NotificationSource, key: string) =>
  deriveNotificationSections(s).flatMap((section) => section.rows).find((r) => r.key === key)!;

describe('NOTIFICATION_CHANNELS', () => {
  it('offers only channels that can actually deliver', () => {
    // WhatsApp (Meta Cloud API) and email (Resend) both send. In-app writes a
    // notifications row. SMS has no provider and push has no infrastructure at
    // all — no FCM, no APNs, no web-push anywhere in the codebase.
    expect(NOTIFICATION_CHANNELS.map((c) => c.key)).toEqual(['whatsapp', 'email', 'in_app']);
  });

  it('never offers push, which has no infrastructure', () => {
    expect(NOTIFICATION_CHANNELS.some((c) => /push/i.test(c.key) || /push/i.test(c.label))).toBe(false);
  });
});

describe('describeSchedule', () => {
  it('describes a single pre-due reminder in the design’s words', () => {
    expect(describeSchedule({ before_due_days: [3], after_due_days: [] })).toBe(
      'Sent 3 days before the due date',
    );
  });

  it('describes reminders on both sides of the due date', () => {
    expect(describeSchedule({ before_due_days: [3], after_due_days: [1, 5] })).toBe(
      'Sent 3 days before, then 1 and 5 days after',
    );
  });

  it('describes after-only reminders', () => {
    expect(describeSchedule({ before_due_days: [], after_due_days: [2] })).toBe(
      'Sent 2 days after the due date',
    );
  });

  it('says so when no reminder days are set at all', () => {
    expect(describeSchedule({ before_due_days: [], after_due_days: [] })).toBe('No reminder days set');
  });
});

describe('deriveNotificationSections', () => {
  it('describes rent reminders from the real schedule', () => {
    expect(find(source(), 'rent-reminders').detail).toBe(
      'Sent 3 days before, then 1 and 5 days after',
    );
  });

  it('treats reminders switched off as off, not as a gap', () => {
    const s = source();
    s.reminders!.enabled = false;

    expect(find(s, 'rent-reminders').state).toBe('off');
  });

  it('flags reminders that are on but have no days set', () => {
    const s = source();
    s.reminders!.schedule = { before_due_days: [], after_due_days: [] };

    expect(find(s, 'rent-reminders').state).toBe('attention');
  });

  it('includes the owner daily summary, which is a real flag', () => {
    expect(find(source(), 'owner-daily-summary')).toBeTruthy();
  });

  it('lists only events that have a real setting behind them', () => {
    // These five had no per-event gating to offer, so they rendered as
    // permanently "Not available yet". They padded a completeness meter the
    // configuration redesign removes.
    for (const key of ['payment-received', 'agreement-ready', 'move-in-out', 'collection-report', 'automation-failure']) {
      expect(find(source(), key)).toBeUndefined();
    }
  });

  it('never claims a delivery time the data does not store', () => {
    // The design says "Collections & occupancy at 9 PM". The flag is a plain
    // boolean — no time is configurable — so no hour may be stated.
    expect(find(source(), 'owner-daily-summary').detail).not.toMatch(/9\s*PM|\d{1,2}:\d{2}/i);
  });
});

describe('buildChannelPatch', () => {
  it('writes a global reminder channel', () => {
    expect(buildChannelPatch('whatsapp', false)).toEqual({
      reminders: { channels: { whatsapp: false } },
    });
  });

  it('targets reminders, not the dead notifications domain', () => {
    // `notifications.channels` exists but nothing reads it — only
    // `reminders.channels` reaches the flat prefs the send path consults.
    const patch = buildChannelPatch('email', true) as Record<string, unknown>;

    expect(Object.keys(patch)).toEqual(['reminders']);
  });
});
