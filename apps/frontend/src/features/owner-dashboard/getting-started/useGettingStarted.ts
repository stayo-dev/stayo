import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { kycApi } from '@features/owner-onboarding/api/kycApi';
import {
  deriveGettingStarted,
  deriveVerificationStatus,
  shouldRunSpotlight,
} from './gettingStarted';

/**
 * Scoped per owner. The previous key was a bare string shared by every account
 * that ever signed in on this browser, and the flag it held was one-way — so
 * after one owner finished setting up, the next owner to sign in on the same
 * device was permanently denied the checklist, including a brand-new account
 * with nothing set up at all. That is the bug that made Home a dead end: the
 * checklist held one of only two "Add hostel" buttons in the app, and the
 * other was hidden on accounts with no hostels. See ADR-139.
 */
function tourKey(ownerId: string | null): string {
  return `stayo_owner_tour_seen:${ownerId ?? 'anonymous'}`;
}

/**
 * Browser storage, guarded. Safari private mode and blocked third-party
 * storage both throw on access, and a walkthrough must never be the thing that
 * takes the dashboard down.
 */
function readFlag(key: string): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string) {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    /* A tour that can't remember itself is a small problem; a crash is not. */
  }
}

interface GettingStartedInput {
  ownerId: string | null;
  roomCapacity: number;
  tenantCount: number;
  /** Lifetime, from the portfolio summary. Never this month's collection. */
  hasEverCollected: boolean;
  hostelInProgress?: { name: string; summary: string } | null;
  /** The dashboard has finished loading — don't guide a skeleton. */
  ready: boolean;
}

/**
 * Assembles the new-owner walkthrough from data the dashboard already holds.
 *
 * **Nothing about completion is stored any more.** All three steps are
 * permanently-true facts about the account (rooms exist, tenants exist, a
 * payment has ever been recorded), so the checklist retires itself by simply
 * being satisfied, and cannot disagree with the account it describes on any
 * device. The only surviving browser state is the one-time tour dismissal,
 * which is a per-device viewing preference rather than a fact about the
 * business — and it is now keyed per owner regardless. See ADR-139.
 */
export function useGettingStarted(input: GettingStartedInput) {
  const key = tourKey(input.ownerId);
  const [tourSeenFor, setTourSeenFor] = useState<Record<string, boolean>>({});
  const tourSeen = tourSeenFor[key] ?? readFlag(key);

  const state = useMemo(
    () =>
      deriveGettingStarted({
        roomCapacity: input.roomCapacity,
        tenantCount: input.tenantCount,
        hasEverCollected: input.hasEverCollected,
        hostelInProgress: input.hostelInProgress,
      }),
    [input.roomCapacity, input.tenantCount, input.hasEverCollected, input.hostelInProgress],
  );

  // Only fetched while it can still be shown. An established owner never pays
  // for a request that feeds a card they will never see.
  const kycQuery = useQuery({
    queryKey: ['owner', 'kyc-documents'],
    queryFn: () => kycApi.list(),
    enabled: input.ready && state.visible,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const verification = useMemo(() => {
    const raw = kycQuery.data as any;
    const documents = Array.isArray(raw?.documents) ? raw.documents : Array.isArray(raw) ? raw : [];
    return deriveVerificationStatus(documents);
  }, [kycQuery.data]);

  const runSpotlight = shouldRunSpotlight({
    roomCapacity: input.roomCapacity,
    isComplete: state.isComplete,
    dismissed: tourSeen,
    ready: input.ready,
  });

  const dismissSpotlight = () => {
    writeFlag(key);
    setTourSeenFor((prev) => ({ ...prev, [key]: true }));
  };

  return { state, verification, runSpotlight, dismissSpotlight };
}
