/**
 * Pure decision logic for the Admin "Add Owner" wizard (Admin -> Direct
 * Owner Onboarding, field/direct marketing channel). Extracted so it's
 * testable under this repo's node-only vitest harness — see
 * `enquiryPhoneVerification.ts` for the same pattern this mirrors. API calls
 * and React state stay in the component; this module only decides *what*
 * should happen next and how to read what already happened.
 */

export type WizardStep = 'details' | 'otp' | 'plan' | 'review' | 'sent';

export type FieldValidation = { valid: true } | { valid: false; error: string };

export function validateName(name: string): FieldValidation {
  return name.trim().length >= 2 ? { valid: true } : { valid: false, error: 'Enter the owner’s name.' };
}

export function validateEmail(email: string): FieldValidation {
  const trimmed = email.trim();
  if (!trimmed) return { valid: false, error: 'Enter the owner’s email.' };
  // Same shape the backend's Zod email() check accepts — good enough to
  // catch typos before a round trip; the server is still the source of truth.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
    ? { valid: true }
    : { valid: false, error: 'Enter a valid email address.' };
}

export function validatePhone(phone: string): FieldValidation {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 8 ? { valid: true } : { valid: false, error: 'Enter a valid phone number.' };
}

export function validateOtpInput(otp: string): FieldValidation {
  return otp.trim().length === 6 ? { valid: true } : { valid: false, error: 'Enter the 6-digit code.' };
}

export type DetailsForm = { name: string; email: string; phone: string };

export function validateDetailsForm(form: DetailsForm): FieldValidation {
  const checks = [validateName(form.name), validateEmail(form.email), validatePhone(form.phone)];
  const firstError = checks.find((c): c is { valid: false; error: string } => !c.valid);
  return firstError ?? { valid: true };
}

export type SendCodeOutcome = { kind: 'submit_immediately' } | { kind: 'await_otp' };

/**
 * What to do after `authApi.sendPhoneOtp` responds. `verification_required:
 * false` means WhatsApp could not deliver a code (ADR-034) and the backend
 * already recorded the number as unverified-but-skippable — showing a
 * code-entry screen for a message that will never arrive would strand the
 * admin mid-flow, so the wizard proceeds without one instead of waiting.
 * Mirrors `enquiryPhoneVerification.ts`'s `resolveSendCodeOutcome`.
 */
export function resolveSendCodeOutcome(result: { verification_required: boolean }): SendCodeOutcome {
  return result.verification_required === false ? { kind: 'submit_immediately' } : { kind: 'await_otp' };
}

/**
 * Maps a known backend error code (from POST /api/platform-admin/owners,
 * PATCH .../onboarding-setup, or POST .../approve) to admin-facing copy.
 * Never surfaces a raw internal error message — see CLAUDE.md's error-
 * handling rule.
 */
const ERROR_MESSAGES: Record<string, string> = {
  OWNER_EXISTS: 'An account already exists for this email or phone number.',
  DUPLICATE_PHONE: 'A pending onboarding already exists for this phone number.',
  PHONE_NOT_VERIFIED: 'Verify the phone number before continuing.',
  VALIDATION_ERROR: 'Check the details entered and try again.',
  PLAN_NOT_FOUND: 'That plan is not available right now.',
  NOT_DIRECT_ADMIN_LEAD: 'This owner cannot have a plan pre-selected.',
  ALREADY_INVITED: 'The onboarding link has already been sent for this owner.',
  FOUNDING_FULL: 'All Founding Partner slots are currently taken.',
};

export function describeAddOwnerError(code: string | undefined | null): string {
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  return 'Something went wrong. Please try again.';
}

/** Reads the `{code, message}` shape apiError()/api-client attach to a failed request. */
export function getErrorCode(err: unknown): string | undefined {
  const anyErr = err as any;
  return anyErr?.response?.data?.error?.code;
}

export type PlanOption = { code: string; name: string; is_public: boolean };

/**
 * Founding Partner is admin-assigned only (`is_public: false` — see
 * subscription-rules.ts) — the existing Subscriptions page already hides it
 * from an owner's own plan picker but shows it in the admin change-plan
 * control. The Add Owner wizard is an admin control too, so it lists every
 * active plan exactly like that control does, never a hardcoded subset.
 */
export function sortPlanOptions(plans: PlanOption[]): PlanOption[] {
  return [...plans].sort((a, b) => {
    if (a.code === 'FOUNDING') return -1;
    if (b.code === 'FOUNDING') return 1;
    return a.name.localeCompare(b.name);
  });
}
