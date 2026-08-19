import { useCallback } from 'react';

import { copyToClipboard } from '@lib/share';
import { stayoToast } from '@shared/ui-patterns/Toast';
import {
  buildShareText,
  buildShareUrl,
  shareMethodFor,
  shouldFallbackAfterShareError,
  type ShareTarget,
} from '@shared/lib/shareListing';

/**
 * "Send this hostel to someone" — the same action on the seeker's listing page
 * and on the owner's marketing page, so the two cannot diverge on which URL
 * gets shared. That URL is `/h/<slug>`, whose preview card carries the hostel's
 * photo (see `shareListing.ts` and ADR-084).
 *
 * On a phone this is the OS share sheet, which is the only way to reach
 * Instagram and the only list that knows which chat apps the person has. On a
 * desktop browser — where `navigator.share` almost never exists — it copies
 * the link, which is what someone would have done by hand anyway.
 *
 * All of the branching logic lives in the pure module; this hook is the thin
 * layer that touches `navigator`, the clipboard and the toast.
 */
export function useShareHostel() {
  const share = useCallback(async (hostel: ShareTarget) => {
    const url = buildShareUrl(hostel.slug, window.location.origin);

    if (shareMethodFor(typeof navigator !== 'undefined' && typeof navigator.share === 'function') === 'native') {
      try {
        await navigator.share({ title: hostel.name, text: buildShareText(hostel), url });
        return;
      } catch (error) {
        // Dismissing the sheet is not a failure — copying the link and
        // announcing it at someone who just cancelled makes cancel feel broken.
        if (!shouldFallbackAfterShareError(error)) return;
      }
    }

    const copied = await copyToClipboard(url);
    if (copied) stayoToast.success('Link copied — paste it anywhere');
    else stayoToast.error("Couldn't copy the link");
  }, []);

  return { share };
}
