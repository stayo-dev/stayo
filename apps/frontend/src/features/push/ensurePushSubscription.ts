import { isPushSupported, permissionState } from './pushSupport';
import { pushApi } from './api/pushApi';
import { pushSetupStatus, type PushStatus } from './pushSetup';

/**
 * Registering this device for push — the one path every entry point uses: the
 * soft prompt's Enable, the Settings control, and the silent re-registration
 * the app shells run when permission is already granted.
 *
 * Failures are logged, not swallowed. The previous version caught everything
 * and hid the card, which is how a build with no VAPID key and Brave's
 * disabled push service both looked, to everyone, like "nothing happened".
 */

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function iosNeedsInstall(): boolean {
  try {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    return ios && !standalone;
  } catch {
    return false;
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

/** Where this device stands right now. */
export async function readPushStatus(): Promise<PushStatus> {
  const permission = permissionState();
  let subscribed = false;
  try {
    subscribed = (await currentSubscription()) !== null;
  } catch {
    subscribed = false;
  }
  return pushSetupStatus({
    supported: isPushSupported(),
    keyConfigured: Boolean(VAPID),
    permission: permission === 'unsupported' ? 'default' : permission,
    subscribed,
    iosNeedsInstall: iosNeedsInstall(),
  });
}

/**
 * Subscribe this device and tell the server. With `ask`, requests permission
 * first if the browser has not decided; without it, never shows a dialog.
 * Idempotent — the server upserts by endpoint, so re-registering an existing
 * subscription is safe and repairs a server that lost the row.
 */
export async function ensurePushSubscription(options: { ask: boolean }): Promise<PushStatus> {
  if (!isPushSupported() || !VAPID) return readPushStatus();

  try {
    let permission = Notification.permission;
    if (permission === 'default' && options.ask) permission = await Notification.requestPermission();
    if (permission !== 'granted') return readPushStatus();

    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBuffer(VAPID) }));

    const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return readPushStatus();

    await pushApi.subscribe({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
    return 'on';
  } catch (error) {
    // Brave with "Google services for push messaging" off lands here as
    // "Registration failed - push service error". Say so in the console, at
    // least — silence is what made this undiagnosable.
    console.warn('[push] could not subscribe this device:', error);
    throw error;
  }
}
