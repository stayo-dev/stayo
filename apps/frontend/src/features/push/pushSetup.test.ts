import { describe, expect, it } from 'vitest';
import { pushSetupStatus, shouldAutoSubscribe, PUSH_STATUS_COPY } from './pushSetup';

const base = { supported: true, keyConfigured: true, permission: 'default' as const, subscribed: false, iosNeedsInstall: false };

describe('pushSetupStatus', () => {
  it('is on when this device holds a subscription', () => {
    expect(pushSetupStatus({ ...base, permission: 'granted', subscribed: true })).toBe('on');
  });

  it('needs only registering when the browser already allows notifications', () => {
    // The case that stranded owners: allowed from site settings, never subscribed,
    // and the soft prompt only ever appears while permission is still "default".
    expect(pushSetupStatus({ ...base, permission: 'granted' })).toBe('needs-subscription');
  });

  it('asks when the browser has not decided', () => {
    expect(pushSetupStatus(base)).toBe('needs-permission');
  });

  it('says blocked, rather than offering a button that cannot work', () => {
    expect(pushSetupStatus({ ...base, permission: 'denied' })).toBe('blocked');
  });

  it('tells an iPhone user to install first — Safari only pushes to a Home Screen app', () => {
    expect(pushSetupStatus({ ...base, supported: false, iosNeedsInstall: true })).toBe('ios-install-required');
  });

  it('is unsupported where the browser has no push at all', () => {
    expect(pushSetupStatus({ ...base, supported: false })).toBe('unsupported');
  });

  it('reports a build without the key as its own state, not as "unsupported"', () => {
    // This is what production shipped with for twelve days, silently.
    expect(pushSetupStatus({ ...base, keyConfigured: false })).toBe('not-configured');
  });
});

describe('shouldAutoSubscribe', () => {
  it('registers silently only when permission is already granted and nothing is registered', () => {
    expect(shouldAutoSubscribe('needs-subscription')).toBe(true);
    for (const s of ['on', 'needs-permission', 'blocked', 'unsupported', 'ios-install-required', 'not-configured'] as const) {
      expect(shouldAutoSubscribe(s)).toBe(false);
    }
  });
});

describe('PUSH_STATUS_COPY', () => {
  it('gives every state a headline and says what to do', () => {
    for (const copy of Object.values(PUSH_STATUS_COPY)) {
      expect(copy.title.length).toBeGreaterThan(3);
      expect(copy.body.length).toBeGreaterThan(10);
    }
  });
});
