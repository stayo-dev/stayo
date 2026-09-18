import { describe, it, expect } from 'vitest';
import {
  validateName,
  validateEmail,
  validatePhone,
  validateOtpInput,
  validateDetailsForm,
  resolveSendCodeOutcome,
  describeAddOwnerError,
  getErrorCode,
  sortPlanOptions,
} from './addOwnerFlow';

describe('validateName / validateEmail / validatePhone', () => {
  it('rejects a name shorter than 2 characters', () => {
    expect(validateName('A').valid).toBe(false);
    expect(validateName('Asha').valid).toBe(true);
  });

  it('rejects an obviously malformed email', () => {
    expect(validateEmail('not-an-email').valid).toBe(false);
    expect(validateEmail('owner@example.com').valid).toBe(true);
  });

  it('rejects a too-short phone number', () => {
    expect(validatePhone('12345').valid).toBe(false);
    expect(validatePhone('9812345678').valid).toBe(true);
  });

  it('requires exactly 6 digits for the OTP', () => {
    expect(validateOtpInput('123').valid).toBe(false);
    expect(validateOtpInput('123456').valid).toBe(true);
  });
});

describe('validateDetailsForm', () => {
  it('surfaces the first failing field', () => {
    const result = validateDetailsForm({ name: '', email: 'owner@example.com', phone: '9812345678' });
    expect(result.valid).toBe(false);
  });

  it('passes when every field is valid', () => {
    const result = validateDetailsForm({ name: 'Asha', email: 'owner@example.com', phone: '9812345678' });
    expect(result.valid).toBe(true);
  });
});

describe('resolveSendCodeOutcome', () => {
  it('waits for a code when WhatsApp delivery was attempted', () => {
    expect(resolveSendCodeOutcome({ verification_required: true })).toEqual({ kind: 'await_otp' });
  });

  it('proceeds immediately when WhatsApp could not deliver (ADR-034 skip path)', () => {
    expect(resolveSendCodeOutcome({ verification_required: false })).toEqual({ kind: 'submit_immediately' });
  });
});

describe('describeAddOwnerError / getErrorCode', () => {
  it('maps known backend codes to admin-facing copy', () => {
    expect(describeAddOwnerError('OWNER_EXISTS')).toMatch(/already exists/i);
    expect(describeAddOwnerError('PHONE_NOT_VERIFIED')).toMatch(/verify/i);
    expect(describeAddOwnerError('FOUNDING_FULL')).toMatch(/founding/i);
  });

  it('falls back to a generic message for an unknown/missing code, never a raw internal error', () => {
    expect(describeAddOwnerError(undefined)).toBe('Something went wrong. Please try again.');
    expect(describeAddOwnerError('SOME_INTERNAL_DB_ERROR')).toBe('Something went wrong. Please try again.');
  });

  it('reads the error code out of an axios-shaped error', () => {
    const err = { response: { data: { error: { code: 'DUPLICATE_PHONE', message: 'x' } } } };
    expect(getErrorCode(err)).toBe('DUPLICATE_PHONE');
  });

  it('returns undefined for a shape with no error code', () => {
    expect(getErrorCode(new Error('network down'))).toBeUndefined();
  });
});

describe('sortPlanOptions', () => {
  it('always lists Founding Partner first, then alphabetically', () => {
    const plans = [
      { code: 'STARTER', name: 'Starter', is_public: true },
      { code: 'FOUNDING', name: 'Founding Partner', is_public: false },
      { code: 'GROWTH', name: 'Growth', is_public: true },
    ];
    const sorted = sortPlanOptions(plans);
    expect(sorted.map((p) => p.code)).toEqual(['FOUNDING', 'GROWTH', 'STARTER']);
  });
});
