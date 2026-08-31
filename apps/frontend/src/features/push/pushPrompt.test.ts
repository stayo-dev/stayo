import { describe, it, expect } from 'vitest';
import { shouldOfferPush, promptKey, PROMPT_COOLDOWN_DAYS } from './pushPrompt';

const now = new Date('2026-08-30T10:00:00.000Z');
const base = { supported: true, permission: 'default' as const, dismissedAt: null, now };

describe('shouldOfferPush', () => {
  it('offers to someone who has never been asked', () => {
    expect(shouldOfferPush(base)).toBe(true);
  });

  it('never offers where push is unsupported, such as an iPhone in a browser tab', () => {
    expect(shouldOfferPush({ ...base, supported: false })).toBe(false);
  });

  it('never re-asks once granted', () => {
    expect(shouldOfferPush({ ...base, permission: 'granted' })).toBe(false);
  });

  it('never re-asks once blocked, because the browser prompt is spent', () => {
    expect(shouldOfferPush({ ...base, permission: 'denied' })).toBe(false);
  });

  it('stays quiet during the cooldown after a soft dismissal', () => {
    const dismissedAt = new Date('2026-08-28T10:00:00.000Z'); // 2 days ago
    expect(shouldOfferPush({ ...base, dismissedAt })).toBe(false);
  });

  it('offers again once the cooldown has elapsed', () => {
    const dismissedAt = new Date('2026-08-01T10:00:00.000Z'); // 29 days ago
    expect(shouldOfferPush({ ...base, dismissedAt })).toBe(true);
  });

  it('offers exactly at the cooldown boundary', () => {
    const dismissedAt = new Date(now.getTime() - PROMPT_COOLDOWN_DAYS * 86400_000);
    expect(shouldOfferPush({ ...base, dismissedAt })).toBe(true);
  });
});

describe('promptKey', () => {
  it('scopes the dismissal to one profile', () => {
    expect(promptKey('profile-a')).not.toBe(promptKey('profile-b'));
  });

  it('refuses a key with no profile, rather than sharing one across accounts', () => {
    expect(promptKey(null)).toBeNull();
    expect(promptKey('  ')).toBeNull();
  });
});
