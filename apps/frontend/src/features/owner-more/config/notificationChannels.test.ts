import { describe, it, expect } from 'vitest';
import { NOTIFICATION_CHANNELS, buildChannelPatch } from './notificationChannels';

describe('NOTIFICATION_CHANNELS', () => {
  it('offers only channels that can actually deliver', () => {
    expect(NOTIFICATION_CHANNELS.map((c) => c.key)).toEqual(['whatsapp', 'email', 'in_app', 'push']);
  });

  it('never offers SMS, which nothing in the codebase sends', () => {
    // The flag is stored, but a toggle that persists a preference changing
    // nothing observable is worse than no toggle.
    expect(NOTIFICATION_CHANNELS.some((c) => c.key === ('sms' as any))).toBe(false);
  });

  it('labels every channel for a reader, not for the database', () => {
    for (const channel of NOTIFICATION_CHANNELS) {
      expect(channel.label).toBeTruthy();
      expect(channel.label).not.toBe(channel.key);
    }
  });
});

describe('buildChannelPatch', () => {
  it('writes one channel, so a stale render cannot overwrite another', () => {
    expect(buildChannelPatch('whatsapp', true)).toEqual({ reminders: { channels: { whatsapp: true } } });
    expect(buildChannelPatch('email', false)).toEqual({ reminders: { channels: { email: false } } });
  });

  it('touches nothing outside the channel map', () => {
    const patch = buildChannelPatch('push', true) as any;
    expect(patch.reminders.schedule).toBeUndefined();
    expect(patch.automation).toBeUndefined();
  });
});
