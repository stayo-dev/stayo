import { useCallback, useMemo, useState } from 'react';
import { isPushSupported, permissionState } from './pushSupport';
import { shouldOfferPush, promptKey } from './pushPrompt';
import { pushApi } from './api/pushApi';

function readDismissedAt(key: string | null): Date | null {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? new Date(Number(raw)) : null;
  } catch {
    return null;
  }
}

function writeDismissedAt(key: string | null) {
  if (!key) return;
  try {
    window.localStorage.setItem(key, String(Date.now()));
  } catch {
    /* A prompt that cannot remember a dismissal is a small problem; a crash is not. */
  }
}

/** The VAPID public key must reach `subscribe()` as bytes, not base64url text. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = window.atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * The soft prompt's state, and the escalation to the real browser dialog.
 *
 * Everything here is failure-tolerant on purpose: this hangs off screens about
 * rent and enquiries, and no push problem may ever surface there. A refusal, a
 * missing service worker, an unconfigured VAPID key and a thrown `subscribe`
 * all end the same way — the card goes away and the app carries on.
 */
export function usePushSubscription(profileId: string | null) {
  const key = promptKey(profileId);
  const [dismissedNow, setDismissedNow] = useState(false);
  const [enabled, setEnabled] = useState(false);

  const offer = useMemo(() => {
    if (dismissedNow || enabled) return false;
    return shouldOfferPush({
      supported: isPushSupported(),
      permission: permissionState(),
      dismissedAt: readDismissedAt(key),
      now: new Date(),
    });
  }, [key, dismissedNow, enabled]);

  const enable = useCallback(async () => {
    try {
      const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
      // Without a key there is nothing to subscribe to; asking for permission
      // would burn the one-shot prompt for a subscription we cannot create.
      if (!vapid) {
        setDismissedNow(true);
        return;
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        // A block is permanent. Stop offering rather than nagging.
        setDismissedNow(true);
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid),
      });
      const json = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

      await pushApi.subscribe({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
      setEnabled(true);
    } catch {
      // Never surfaced. The app works fine without push.
      setDismissedNow(true);
    }
  }, []);

  const dismiss = useCallback(() => {
    writeDismissedAt(key);
    setDismissedNow(true);
  }, [key]);

  return { offer, enable, dismiss };
}
