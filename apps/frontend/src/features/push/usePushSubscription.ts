import { useCallback, useMemo, useState } from 'react';
import { isPushSupported, permissionState } from './pushSupport';
import { shouldOfferPush, promptKey } from './pushPrompt';
import { ensurePushSubscription } from './ensurePushSubscription';

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
      const status = await ensurePushSubscription({ ask: true });
      if (status === 'on') setEnabled(true);
      else setDismissedNow(true);
    } catch {
      // Logged by ensurePushSubscription. The card goes; the page carries on.
      setDismissedNow(true);
    }
  }, []);

  const dismiss = useCallback(() => {
    writeDismissedAt(key);
    setDismissedNow(true);
  }, [key]);

  return { offer, enable, dismiss };
}
