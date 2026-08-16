/**
 * Pure decision logic for `EnquiryPage`'s phone-verification step, extracted
 * so it's testable under this repo's node-only vitest harness (no jsdom —
 * see `vitest.config.ts`'s own comment on why components stay thin
 * renderers over already-tested state). API calls and React state stay in
 * the component; this module only decides *what* should happen next, never
 * performs it.
 *
 * Context: phone verification moved from signup-time to enquiry-time
 * (2026-08-16, ADR-078) — a Google-provisioned account has no phone on file
 * at all, so `EnquiryPage` gates submission on `phone_verified` and, when
 * it's false, walks through confirm-phone → OTP → submit inline.
 */

export interface PhoneVerificationUser {
  phone?: string | null;
  phone_verified?: boolean;
  name?: string | null;
}

/**
 * Whether the enquiry form must confirm-and-verify a phone before
 * submitting. `isSeeker` gates it first — a signed-out visitor sees the
 * sign-in prompt instead, never this step.
 */
export function needsPhoneVerification(isSeeker: boolean, user: PhoneVerificationUser | null | undefined): boolean {
  return isSeeker && !user?.phone_verified;
}

export type FieldValidation = { valid: true } | { valid: false; error: string };

/** A phone number must be present — format/normalization is validated server-side by `send-phone-otp`. */
export function validatePhoneInput(phone: string): FieldValidation {
  return phone.trim().length > 0 ? { valid: true } : { valid: false, error: 'Enter your phone number.' };
}

/** OTPs from this backend are always a 6-digit code (`auth-otp-service.ts`'s `OTP_LENGTH_MIN`/`MAX_EXCLUSIVE`). */
export function validateOtpInput(otp: string): FieldValidation {
  return otp.trim().length === 6 ? { valid: true } : { valid: false, error: 'Enter the 6-digit code.' };
}

/**
 * Whether the name on the account should be updated before sending the
 * OTP — only when the visitor actually typed something different from
 * what's already on file, so an untouched prefilled field never fires a
 * wasted `PATCH /api/profile`.
 */
export function shouldUpdateName(nameInput: string, currentName: string | null | undefined): boolean {
  const trimmed = nameInput.trim();
  return trimmed.length > 0 && trimmed !== (currentName ?? '');
}

export type SendCodeOutcome = { kind: 'submit_immediately' } | { kind: 'await_otp' };

/**
 * What to do after `sendPhoneOtp` responds. `verification_required: false`
 * means WhatsApp could not deliver a code (ADR-034) and the backend already
 * recorded the number as unverified-but-skippable — showing a code-entry
 * screen for a message that will never arrive would strand the visitor
 * mid-enquiry, so the enquiry proceeds without one instead of waiting.
 */
export function resolveSendCodeOutcome(result: { verification_required: boolean }): SendCodeOutcome {
  return result.verification_required === false ? { kind: 'submit_immediately' } : { kind: 'await_otp' };
}
