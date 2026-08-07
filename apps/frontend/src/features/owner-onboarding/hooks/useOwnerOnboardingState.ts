import { useEffect, useMemo, useRef, useState } from 'react';
import {
  clearStoredDraft,
  isDraftResumable,
  readStoredDraft,
  writeStoredDraft,
  type OnboardingDraft,
} from '../onboardingDraft';
import { validateOnboardingStep } from './onboardingValidation';

export const ONBOARDING_SCREENS = [
  'welcome',
  'account',
  'kyc',
  'create',
  'location',
  'details',
  'floors',
  'rooms',
  'beds',
  'review',
  'publish',
  'success',
] as const;

export type OnboardingScreen = (typeof ONBOARDING_SCREENS)[number];

export interface OwnerOnboardingData {
  name: string;
  mobile: string;
  email: string;
  hostelName: string;
  type: 'Boys' | 'Girls' | 'Co-Living' | 'Working Pros';
  address: string;
  city: string;
  floors: number;
  capacity: number;
  food: 'Yes' | 'No';
  /**
   * Resolved security deposit in rupees — the single figure the backend
   * stores. Derived from the three fields below by `resolveDepositAmount`;
   * "0" is a real answer meaning no deposit is taken.
   */
  deposit: string;
  /** How the owner expresses the deposit. NONE means they take none at all. */
  depositMode: 'NONE' | 'MONTHS' | 'FLAT';
  /** Months of rent, when depositMode is MONTHS. */
  depositMonths: string;
  /** Starting monthly rent, applied to every room publish creates. */
  monthlyRent: string;
  roomsPerFloor: number;
  bedsPerRoom: number;
}

export interface OwnerOnboardingKyc {
  aadhaar: boolean;
  pan: boolean;
  photo: boolean;
}

const INITIAL_DATA: OwnerOnboardingData = {
  name: '',
  mobile: '',
  email: '',
  hostelName: '',
  type: 'Co-Living',
  address: '',
  city: '',
  floors: 4,
  capacity: 168,
  food: 'Yes',
  deposit: '',
  depositMode: 'MONTHS',
  depositMonths: '2',
  monthlyRent: '',
  roomsPerFloor: 10,
  bedsPerRoom: 4,
};

/**
 * Step/data/generation state for the 12-step onboarding wizard, mirroring
 * `Owner Onboarding.dc.html`'s `state`/`setD`/`go` — same field names, same
 * step order, same floors/rooms/beds "generate" gating — so the port stays a
 * faithful translation rather than a redesign.
 *
 * `initialData` (owner-acquisition funnel phase 2): optional prefill from a
 * lead-activation link (OwnerLeadInvitePage → router state). Absent for a
 * normal, non-lead-originated visit — behavior is unchanged in that case.
 */
export function useOwnerOnboardingState(initialData?: Partial<OwnerOnboardingData>) {
  // Restore synchronously on first render so the wizard never flashes empty
  // fields before filling them in.
  const restoredRef = useRef<OnboardingDraft | null>(
    typeof window === 'undefined' ? null : readStoredDraft(),
  );
  const restored = restoredRef.current;

  // A lead-activation prefill is fresher intent than an old local draft, so it
  // wins on the fields it actually provides.
  const [step, setStep] = useState(() => (isDraftResumable(restored) ? restored!.step : 0));
  const [data, setData] = useState<OwnerOnboardingData>(() => ({
    ...INITIAL_DATA,
    ...(isDraftResumable(restored) ? restored!.data : {}),
    ...initialData,
  }));
  const [draftRestored, setDraftRestored] = useState(() => isDraftResumable(restored));
  const [kyc, setKyc] = useState<OwnerOnboardingKyc>({ aadhaar: false, pan: false, photo: false });
  const [floorsGen, setFloorsGen] = useState(false);
  const [roomsGen, setRoomsGen] = useState(false);
  const [bedsGen, setBedsGen] = useState(false);
  const [publishChoice, setPublishChoice] = useState<'now' | 'draft'>('now');
  const [otpOpen, setOtpOpen] = useState(false);

  const screenId = ONBOARDING_SCREENS[step];

  // Auto-save on every change. Cheap (a few hundred bytes) and it is the whole
  // point — an owner who closes the tab must not lose eight steps of answers.
  // Never runs on the success screen: the hostel exists by then and a stale
  // draft would offer to "resume" an onboarding that already finished.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (screenId === 'success') return;
    writeStoredDraft({ step, data });
  }, [step, data, screenId]);

  /** Discard the saved draft and start from an empty wizard. */
  const startOver = () => {
    clearStoredDraft();
    setDraftRestored(false);
    setData({ ...INITIAL_DATA, ...initialData });
    setStep(0);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  };

  /** Keep the restored answers but stop showing the resume banner. */
  const dismissDraftBanner = () => setDraftRestored(false);

  const setD = (patch: Partial<OwnerOnboardingData>) => setData((d) => ({ ...d, ...patch }));

  const go = (n: number) => {
    setStep(Math.max(0, Math.min(ONBOARDING_SCREENS.length - 1, n)));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  };

  const back = () => go(step - 1);

  /** Why the current step can't be left yet, or null when it's complete. */
  const currentStepError = () => validateOnboardingStep(screenId, data);

  const next = () => {
    if (screenId === 'account') {
      setOtpOpen(true);
      return;
    }
    go(step + 1);
  };

  const verifyOtp = () => {
    setOtpOpen(false);
    go(step + 1);
  };

  const totalRooms = data.floors * data.roomsPerFloor;
  const totalBeds = totalRooms * data.bedsPerRoom;
  const hostelDisplay = data.hostelName.trim() || 'Your Hostel';

  const continueLabel = useMemo(() => {
    const labels: Record<OnboardingScreen, string> = {
      welcome: 'Begin the journey',
      account: 'Continue',
      kyc: 'Continue',
      create: 'Continue',
      location: 'Continue',
      details: 'Continue',
      floors: 'Continue',
      rooms: 'Continue',
      beds: 'Continue',
      review: 'Looks perfect',
      publish: publishChoice === 'now' ? 'Publish now' : 'Save & finish',
      success: 'Go to dashboard',
    };
    return labels[screenId];
  }, [screenId, publishChoice]);

  return {
    step,
    screenId,
    currentStepError,
    data,
    setD,
    kyc,
    setKyc,
    floorsGen,
    setFloorsGen,
    roomsGen,
    setRoomsGen,
    bedsGen,
    setBedsGen,
    publishChoice,
    setPublishChoice,
    otpOpen,
    setOtpOpen,
    go,
    back,
    next,
    verifyOtp,
    totalRooms,
    totalBeds,
    hostelDisplay,
    continueLabel,
    canBack: step > 0 && screenId !== 'success',
    draftRestored,
    startOver,
    dismissDraftBanner,
  };
}

export type OwnerOnboardingStateApi = ReturnType<typeof useOwnerOnboardingState>;
