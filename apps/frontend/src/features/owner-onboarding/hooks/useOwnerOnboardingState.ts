import { useEffect, useMemo, useRef, useState } from 'react';
import {
  clearStoredDraft,
  isDraftResumable,
  readStoredDraft,
  writeStoredDraft,
  type OnboardingDraft,
} from '../onboardingDraft';
import { validateOnboardingStep } from './onboardingValidation';

/**
 * Onboarding covers only what onboarding alone can do: create the account and
 * verify the owner.
 *
 * Hostel creation used to live here as eight further screens (`create`,
 * `location`, `details`, `floors`, `rooms`, `beds`, `review`, `publish`).
 * They asked for floors, rooms-per-floor, beds-per-room and one rent — four
 * scalars that could not describe a floor mixing 4-sharing and 2-sharing
 * rooms at different prices, so the building was wrong on arrival and had to
 * be corrected room by room anyway. That work now happens in Add Hostel, when
 * the owner chooses to do it. See ADR-064.
 */
export const ONBOARDING_SCREENS = ['welcome', 'account', 'kyc', 'success'] as const;

export type OnboardingScreen = (typeof ONBOARDING_SCREENS)[number];

export interface OwnerOnboardingData {
  name: string;
  mobile: string;
  email: string;
  /** Carried only to prefill Add Hostel when the owner heads there next. */
  hostelName: string;
  city: string;
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
  city: '',
};

/**
 * Step/data state for the onboarding wizard.
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
  const currentStepError = () => validateOnboardingStep(screenId, data, kyc);

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

  const hostelDisplay = data.hostelName.trim() || 'Your Hostel';

  const continueLabel = useMemo(() => {
    const labels: Record<OnboardingScreen, string> = {
      welcome: 'Begin the journey',
      account: 'Continue',
      kyc: 'Continue',
      success: 'Go to dashboard',
    };
    return labels[screenId];
  }, [screenId]);

  return {
    step,
    screenId,
    currentStepError,
    data,
    setD,
    kyc,
    setKyc,
    otpOpen,
    setOtpOpen,
    go,
    back,
    next,
    verifyOtp,
    hostelDisplay,
    continueLabel,
    canBack: step > 0 && screenId !== 'success',
    draftRestored,
    startOver,
    dismissDraftBanner,
  };
}

export type OwnerOnboardingStateApi = ReturnType<typeof useOwnerOnboardingState>;
