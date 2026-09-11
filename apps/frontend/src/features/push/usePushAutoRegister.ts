import { useEffect } from 'react';
import { ensurePushSubscription, readPushStatus } from './ensurePushSubscription';
import { shouldAutoSubscribe } from './pushSetup';

/**
 * Finish push setup on a device that has already said yes.
 *
 * A browser can allow notifications without ever subscribing — from its site
 * settings, after clearing data, or on a new phone — and the soft prompt only
 * appears while permission is still "default", so such a device had no way in.
 * Mounted in the signed-in app shells, this registers it quietly on first load.
 *
 * Never prompts (see `shouldAutoSubscribe`), runs once per page load, and
 * ignores failure: this sits under every signed-in screen, and nothing about
 * push may ever interrupt one.
 */

let attempted = false;

export function usePushAutoRegister() {
  useEffect(() => {
    if (attempted) return;
    attempted = true;
    void (async () => {
      try {
        if (shouldAutoSubscribe(await readPushStatus())) await ensurePushSubscription({ ask: false });
      } catch {
        // Logged inside ensurePushSubscription.
      }
    })();
  }, []);
}
