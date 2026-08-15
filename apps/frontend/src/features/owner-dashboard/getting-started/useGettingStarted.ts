import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { kycApi } from '@features/owner-onboarding/api/kycApi';
import {
  deriveGettingStarted,
  deriveVerificationStatus,
  shouldRunSpotlight,
} from './gettingStarted';

const GRADUATED_KEY = 'stayo_owner_getting_started_done';
const SPOTLIGHT_KEY = 'stayo_owner_tour_seen';

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
  roomCapacity: number;
  tenantCount: number;
  collectedThisMonth: number;
  hostelInProgress?: { name: string; summary: string } | null;
  /** The dashboard has finished loading — don't guide a skeleton. */
  ready: boolean;
}

/**
 * Assembles the new-owner walkthrough from data the dashboard already holds.
 *
 * The only stored state is two one-way flags. Everything else is derived, so
 * the checklist cannot disagree with the account it describes.
 */
export function useGettingStarted(input: GettingStartedInput) {
  const [graduated, setGraduated] = useState(() => readFlag(GRADUATED_KEY));
  const [tourSeen, setTourSeen] = useState(() => readFlag(SPOTLIGHT_KEY));

  // Only fetched while it can still be shown. An established owner never pays
  // for a request that feeds a card they will never see.
  const kycQuery = useQuery({
    queryKey: ['owner', 'kyc-documents'],
    queryFn: () => kycApi.list(),
    enabled: input.ready && !graduated,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const state = useMemo(
    () =>
      deriveGettingStarted({
        roomCapacity: input.roomCapacity,
        tenantCount: input.tenantCount,
        collectedThisMonth: input.collectedThisMonth,
        hostelInProgress: input.hostelInProgress,
        graduated,
      }),
    [input.roomCapacity, input.tenantCount, input.collectedThisMonth, input.hostelInProgress, graduated],
  );

  // Latch on the first observation of completion. The payment signal is
  // this-month-only, so without this the card returns every 1st of the month
  // to tell a long-running hostel it has never taken rent.
  useEffect(() => {
    if (input.ready && state.isComplete && !graduated) {
      writeFlag(GRADUATED_KEY);
      setGraduated(true);
    }
  }, [input.ready, state.isComplete, graduated]);

  const verification = useMemo(() => {
    const raw = kycQuery.data as any;
    const documents = Array.isArray(raw?.documents) ? raw.documents : Array.isArray(raw) ? raw : [];
    return deriveVerificationStatus(documents);
  }, [kycQuery.data]);

  const runSpotlight = shouldRunSpotlight({
    roomCapacity: input.roomCapacity,
    tenantCount: input.tenantCount,
    dismissed: tourSeen,
    ready: input.ready,
  });

  const dismissSpotlight = () => {
    writeFlag(SPOTLIGHT_KEY);
    setTourSeen(true);
  };

  return { state, verification, runSpotlight, dismissSpotlight };
}
