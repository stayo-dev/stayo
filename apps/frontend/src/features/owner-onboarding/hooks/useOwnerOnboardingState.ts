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
 * Onboarding covers only what onboarding alone can do: KYC.
 *
 * Hostel creation used to live here as eight further screens (`create`,
 * `location`, `details`, `floors`, `rooms`, `beds`, `review`, `publish`).
 * They asked for floors, rooms-per-floor, beds-per-room and one rent — four
 * scalars that could not describe a floor mixing 4-sharing and 2-sharing
 * rooms at different prices, so the building was wrong on arrival and had to
 * be corrected room by room anyway. That work now happens in Add Hostel, when
 * the owner chooses to do it. See ADR-066.
 *
 * Account creation (name/mobile/OTP/email/password) used to live here too, as
 * an `account` step reachable with no token at all — anyone who typed
 * `/onboarding` got a working self-signup form. That step moved to
 * `/activation/:token` (OwnerActivationPage), which the backend validates
 * against a specific admin-approved lead invitation before creating any
 * account; this wizard is now only reachable by an already-authenticated
 * owner (see ProtectedRoute in OwnerJourneyRoutes.tsx).
 */
export const ONBOARDING_SCREENS = ['welcome', 'kyc', 'success'] as const;

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

/** Step/data state for the onboarding wizard. */
export function useOwnerOnboardingState() {
  // Restore synchronously on first render so the wizard never flashes empty
  // fields before filling them in.
  const restoredRef = useRef<OnboardingDraft | null>(
    typeof window === 'undefined' ? null : readStoredDraft(),
  );
  const restored = restoredRef.current;

  const [step, setStep] = useState(() => (isDraftResumable(restored) ? restored!.step : 0));
  const [data, setData] = useState<OwnerOnboardingData>(() => ({
    ...INITIAL_DATA,
    ...(isDraftResumable(restored) ? restored!.data : {}),
  }));
  const [draftRestored, setDraftRestored] = useState(() => isDraftResumable(restored));
  const [kyc, setKyc] = useState<OwnerOnboardingKyc>({ aadhaar: false, pan: false, photo: false });

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
    setData({ ...INITIAL_DATA });
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

  const next = () => go(step + 1);

  const hostelDisplay = data.hostelName.trim() || 'Your Hostel';

  const continueLabel = useMemo(() => {
    const labels: Record<OnboardingScreen, string> = {
      welcome: 'Begin the journey',
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
    go,
    back,
    next,
    hostelDisplay,
    continueLabel,
    canBack: step > 0 && screenId !== 'success',
    draftRestored,
    startOver,
    dismissDraftBanner,
  };
}

export type OwnerOnboardingStateApi = ReturnType<typeof useOwnerOnboardingState>;
