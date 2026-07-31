import { useMemo, useState } from 'react';
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
  deposit: string;
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
  deposit: '10000',
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
  const [step, setStep] = useState(0);
  const [data, setData] = useState<OwnerOnboardingData>(() => ({ ...INITIAL_DATA, ...initialData }));
  const [kyc, setKyc] = useState<OwnerOnboardingKyc>({ aadhaar: false, pan: false, photo: false });
  const [floorsGen, setFloorsGen] = useState(false);
  const [roomsGen, setRoomsGen] = useState(false);
  const [bedsGen, setBedsGen] = useState(false);
  const [publishChoice, setPublishChoice] = useState<'now' | 'draft'>('now');
  const [otpOpen, setOtpOpen] = useState(false);

  const screenId = ONBOARDING_SCREENS[step];

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
  };
}

export type OwnerOnboardingStateApi = ReturnType<typeof useOwnerOnboardingState>;
