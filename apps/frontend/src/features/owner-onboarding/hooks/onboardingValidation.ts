import type { OnboardingScreen, OwnerOnboardingData, OwnerOnboardingKyc } from './useOwnerOnboardingState';

/**
 * What each onboarding step requires before it will let you move on.
 *
 * Kept as one table rather than scattered `if`s inside the step components so
 * the wizard can gate Continue centrally, and so the rules are readable in one
 * place — a half-filled hostel is far more expensive to fix after publish than
 * a blocked Continue button is to explain.
 *
 * Returns the message to show, or null when the step is satisfied.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Accepts 10 local digits, optionally with +91/91. */
export function isValidIndianMobile(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return /^[6-9]/.test(digits);
  if (digits.length === 12 && digits.startsWith('91')) return /^[6-9]/.test(digits.slice(2));
  return false;
}

export function validateOnboardingStep(
  screenId: OnboardingScreen,
  data: OwnerOnboardingData,
  kyc?: OwnerOnboardingKyc,
): string | null {
  switch (screenId) {
    // Aadhaar and PAN are both required to *upload*. Approval itself gates
    // going live, not progress through the wizard — an owner who signs up at
    // 11pm must not be stranded waiting for a human to review.
    case 'kyc': {
      if (!kyc) return null;
      const missing: string[] = [];
      if (!kyc.aadhaar) missing.push('Aadhaar');
      if (!kyc.pan) missing.push('PAN');
      if (missing.length === 0) return null;
      return `Upload your ${missing.join(' and ')} to continue — we verify these before your hostel goes live.`;
    }

    case 'account':
      // Credentials themselves are checked in useOnboardingSubmission, which
      // owns the password fields.
      if (data.name.trim().length < 2) return 'Tell us your name first.';
      if (!isValidIndianMobile(data.mobile)) return 'Enter a valid 10-digit Indian mobile number.';
      if (!EMAIL_RE.test(data.email.trim())) return 'Enter a valid email address.';
      return null;

    default:
      return null;
  }
}
