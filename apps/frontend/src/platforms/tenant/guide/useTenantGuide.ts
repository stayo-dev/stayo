import { useCallback, useState } from 'react';
import { useTenantSession } from '@features/tenant-session/useTenantSession';
import { useAppNav } from '@/app/nav/useAppNav';
import { guideKey, shouldShowBeat, type GuideBeat } from './tenantGuide';

/**
 * Browser storage, guarded on both sides.
 *
 * Safari private mode and blocked third-party storage throw on access. A
 * guided journey that cannot remember itself is a small problem — a tenant
 * sees one hint twice. The rent screen throwing on load is not.
 */
function readFlag(key: string | null): boolean {
  if (!key) return false;
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string | null) {
  if (!key) return;
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    /* See above — never let a dismissal be the thing that breaks a screen. */
  }
}

/**
 * One beat of the tenant's guided journey: has it been seen, and how to
 * retire it.
 *
 * The dismissal lives in browser storage rather than on `profiles`, and that
 * is deliberate. "Has this person read a caption on the Food tab" is a
 * per-device viewing preference, not a fact about the tenancy — the sort of
 * thing this repo has already been burned storing as a flag (ADR-139). The
 * cost of losing it is that a tenant who changes phone sees a hint a second
 * time; the cost of a migration and two endpoints for a caption is worse.
 *
 * `ready` is the caller's own "this screen has real data on it" signal, since
 * only the page knows when its skeleton has been replaced.
 */
export function useTenantGuide(beat: GuideBeat, ready: boolean) {
  const { tenantId } = useTenantSession();
  const { dashboardReadOnly } = useAppNav();

  const key = guideKey(beat, tenantId);
  // Storage answers on first render; state carries the dismissal within this
  // session, since writing to localStorage does not trigger a re-render.
  const [dismissed, setDismissed] = useState(false);
  const seen = dismissed || readFlag(key);

  const dismiss = useCallback(() => {
    writeFlag(key);
    setDismissed(true);
  }, [key]);

  return {
    show: shouldShowBeat({ tenantId, seen, ready, readOnly: dashboardReadOnly }),
    dismiss,
  };
}
