import { describe, expect, it } from 'vitest';
import {
  needsPhoneVerification,
  resolveSendCodeOutcome,
  shouldUpdateName,
  validateOtpInput,
  validatePhoneInput,
} from './enquiryPhoneVerification';

/**
 * Phone verification moved from signup-time to enquiry-time (2026-08-16,
 * ADR-078) — a Google-provisioned account has no phone on file at all, so
 * `EnquiryPage` walks confirm-phone → OTP → submit inline before letting an
 * enquiry through. These pin the decision logic driving that step: whether
 * it's needed at all, what counts as valid input, whether the account's
 * name needs updating, and what to do when WhatsApp can't deliver a code
 * (ADR-034's degrade-rather-than-strand behavior).
 */

describe('needsPhoneVerification', () => {
  it('is false for a signed-out visitor, regardless of any stray user object', () => {
    expect(needsPhoneVerification(false, { phone_verified: false })).toBe(false);
    expect(needsPhoneVerification(false, null)).toBe(false);
  });

  it('is true for a seeker with no phone_verified flag at all (fresh Google-provisioned account)', () => {
    expect(needsPhoneVerification(true, {})).toBe(true);
    expect(needsPhoneVerification(true, null)).toBe(true);
    expect(needsPhoneVerification(true, undefined)).toBe(true);
  });

  it('is true for a seeker whose phone exists but is not verified', () => {
    expect(needsPhoneVerification(true, { phone: '+919000000000', phone_verified: false })).toBe(true);
  });

  it('is false once the seeker has a verified phone — never asks again', () => {
    expect(needsPhoneVerification(true, { phone: '+919000000000', phone_verified: true })).toBe(false);
  });
});

describe('validatePhoneInput', () => {
  it('rejects an empty string', () => {
    const result = validatePhoneInput('');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('Enter your phone number.');
  });

  it('rejects whitespace-only input', () => {
    expect(validatePhoneInput('   ').valid).toBe(false);
  });

  it('accepts any non-blank input — format/normalization is the backend\'s job (send-phone-otp)', () => {
    expect(validatePhoneInput('+91 90000 00000').valid).toBe(true);
    expect(validatePhoneInput('9000000000').valid).toBe(true);
  });
});

describe('validateOtpInput', () => {
  it('rejects anything shorter than 6 digits', () => {
    const result = validateOtpInput('12345');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('Enter the 6-digit code.');
  });

  it('rejects anything longer than 6 digits', () => {
    expect(validateOtpInput('1234567').valid).toBe(false);
  });

  it('rejects empty input', () => {
    expect(validateOtpInput('').valid).toBe(false);
  });

  it('accepts exactly 6 characters after trimming', () => {
    expect(validateOtpInput('123456').valid).toBe(true);
    expect(validateOtpInput('  123456  ').valid).toBe(true);
  });
});

describe('shouldUpdateName', () => {
  it('is false when the input is blank — never overwrite a real name with nothing', () => {
    expect(shouldUpdateName('', 'Priya Sharma')).toBe(false);
    expect(shouldUpdateName('   ', 'Priya Sharma')).toBe(false);
  });

  it('is false when the input is blank and there is no current name either', () => {
    expect(shouldUpdateName('', null)).toBe(false);
    expect(shouldUpdateName('', undefined)).toBe(false);
  });

  it('is false when the input exactly matches what is already on file — no wasted PATCH for an untouched prefilled field', () => {
    expect(shouldUpdateName('Priya Sharma', 'Priya Sharma')).toBe(false);
  });

  it('is true when the input genuinely differs from what is on file', () => {
    expect(shouldUpdateName('Priya S. Sharma', 'Priya Sharma')).toBe(true);
  });

  it('is true when there is no current name at all and the visitor typed one (fresh Google account, name missing)', () => {
    expect(shouldUpdateName('Priya Sharma', null)).toBe(true);
    expect(shouldUpdateName('Priya Sharma', undefined)).toBe(true);
  });
});

describe('resolveSendCodeOutcome', () => {
  it('awaits an OTP when a code genuinely went out', () => {
    expect(resolveSendCodeOutcome({ verification_required: true })).toEqual({ kind: 'await_otp' });
  });

  it('submits immediately when WhatsApp could not deliver a code (ADR-034) — never strands the visitor on a code screen for a message that will never arrive', () => {
    expect(resolveSendCodeOutcome({ verification_required: false })).toEqual({ kind: 'submit_immediately' });
  });
});
