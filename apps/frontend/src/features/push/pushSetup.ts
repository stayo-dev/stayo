/**
 * Where this device stands with push, and what the owner or tenant should be
 * told about it — the pure half of `ensurePushSubscription` / `PushSettingsCard`.
 *
 * Push setup failed silently in every way it could. The build shipped without
 * its VAPID key for twelve days and "Enable" simply hid itself; a browser whose
 * notifications were allowed from site settings could never subscribe, because
 * the soft prompt only appears while permission is still "default"; and Brave,
 * which disables its push service by default, threw inside a `try` that
 * swallowed it. Each of those is a named state here, with words for it.
 */

export type PushStatus =
  | 'on'
  | 'needs-subscription'
  | 'needs-permission'
  | 'blocked'
  | 'ios-install-required'
  | 'unsupported'
  | 'not-configured';

export interface PushSetupInput {
  /** Service worker + PushManager + Notification all present. */
  supported: boolean;
  /** `VITE_VAPID_PUBLIC_KEY` was present at build time. */
  keyConfigured: boolean;
  permission: 'default' | 'granted' | 'denied';
  /** This browser holds a push subscription. */
  subscribed: boolean;
  /** iPhone/iPad Safari not opened from the Home Screen — the only way iOS pushes. */
  iosNeedsInstall: boolean;
}

export function pushSetupStatus(input: PushSetupInput): PushStatus {
  if (!input.supported) return input.iosNeedsInstall ? 'ios-install-required' : 'unsupported';
  if (!input.keyConfigured) return 'not-configured';
  if (input.permission === 'denied') return 'blocked';
  if (input.permission === 'default') return 'needs-permission';
  return input.subscribed ? 'on' : 'needs-subscription';
}

/**
 * Register without asking only when the user has already said yes and nothing
 * is registered. Never prompts: a permission dialog that appears on its own,
 * unasked, is exactly what trains people to press Block.
 */
export function shouldAutoSubscribe(status: PushStatus): boolean {
  return status === 'needs-subscription';
}

export const PUSH_STATUS_COPY: Record<PushStatus, { title: string; body: string }> = {
  on: {
    title: 'On for this device',
    body: 'You’ll get rent, payment and enquiry alerts here even when Stayo is closed.',
  },
  'needs-subscription': {
    title: 'Almost on',
    body: 'Notifications are allowed in this browser — tap Turn on to finish setting up this device.',
  },
  'needs-permission': {
    title: 'Off for this device',
    body: 'Get rent, payment and enquiry alerts even when Stayo is closed. Your browser will ask once.',
  },
  blocked: {
    title: 'Blocked in this browser',
    body: 'Notifications for yourstayo.com are blocked. Allow them in the browser’s site settings, then come back here.',
  },
  'ios-install-required': {
    title: 'Add Stayo to your Home Screen first',
    body: 'On iPhone, notifications only work from the Home Screen app: tap Share, then Add to Home Screen, and open Stayo from there.',
  },
  unsupported: {
    title: 'Not available in this browser',
    body: 'This browser can’t receive notifications. Chrome on Android, or Stayo added to an iPhone’s Home Screen, can.',
  },
  'not-configured': {
    title: 'Not available yet',
    body: 'Notifications aren’t set up on this version of Stayo. Please check back after the next update.',
  },
};
