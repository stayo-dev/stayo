import type { OnboardingScreen, OwnerOnboardingData } from './useOwnerOnboardingState';

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
): string | null {
  switch (screenId) {
    case 'account':
      // Credentials themselves are checked in useOnboardingSubmission, which
      // owns the password fields.
      if (data.name.trim().length < 2) return 'Tell us your name first.';
      if (!isValidIndianMobile(data.mobile)) return 'Enter a valid 10-digit Indian mobile number.';
      if (!EMAIL_RE.test(data.email.trim())) return 'Enter a valid email address.';
      return null;

    case 'create':
      if (data.hostelName.trim().length < 2) return 'Give your hostel a name.';
      return null;

    case 'location':
      if (data.address.trim().length < 6) return 'Add the full address so tenants can find it.';
      if (data.city.trim().length < 2) return 'Which city is it in?';
      return null;

    case 'details': {
      if (data.capacity < 1) return 'Total capacity must be at least 1 bed.';
      const deposit = Number(String(data.deposit).replace(/[^0-9.]/g, ''));
      if (!data.deposit || Number.isNaN(deposit) || deposit < 0) {
        return 'Enter the security deposit (0 if you don’t take one).';
      }
      // Required, not optional: every room publish creates inherits this as its
      // base rent, and a room with no rent shows ₹0 on the room grid and
      // prefills nothing when inviting a tenant into it.
      const rent = Number(String(data.monthlyRent).replace(/[^0-9.]/g, ''));
      if (!data.monthlyRent || Number.isNaN(rent) || rent <= 0) {
        return 'Enter the starting monthly rent for a room.';
      }
      return null;
    }

    case 'floors':
      if (data.floors < 1) return 'A hostel needs at least one floor.';
      return null;

    case 'rooms':
      if (data.roomsPerFloor < 1) return 'Add at least one room per floor.';
      return null;

    case 'beds':
      if (data.bedsPerRoom < 1) return 'Add at least one bed per room.';
      return null;

    default:
      return null;
  }
}
