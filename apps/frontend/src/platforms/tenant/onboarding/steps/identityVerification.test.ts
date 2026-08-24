import { describe, expect, it } from 'vitest';
import { canSubmitIdentity, isSamePhone, needsPhoneOtp } from './identityVerification';

const INVITED = '919000000000';
const TYPED = '9000000000';
const DIFFERENT = '9111111111';

const trusted = { phone: INVITED, trusted: true };
const untrusted = { phone: INVITED, trusted: false };

describe('comparing the entered number with the invited one', () => {
  it('matches a 91-prefixed invitation number against a plain 10-digit entry', () => {
    // The field shows +91 separately, so what the user types is 10 digits while
    // the invitation stores 12. Treating those as different would demand an OTP
    // from everyone.
    expect(isSamePhone(TYPED, INVITED)).toBe(true);
  });

  it('ignores spaces and punctuation', () => {
    expect(isSamePhone('90000 00000', INVITED)).toBe(true);
  });

  it('does not match a different number', () => {
    expect(isSamePhone(DIFFERENT, INVITED)).toBe(false);
  });

  it('does not match a half-typed number', () => {
    expect(isSamePhone('90000', INVITED)).toBe(false);
  });
});

describe('whether an OTP is still required', () => {
  it('is not, for the number the invitation was delivered to', () => {
    // The whole point: we WhatsApp'd the link to this number, so asking them to
    // prove it again proves nothing.
    expect(needsPhoneOtp({ enteredPhone: TYPED, trust: trusted })).toBe(false);
  });

  it('is, once they edit it to a different number', () => {
    expect(needsPhoneOtp({ enteredPhone: DIFFERENT, trust: trusted })).toBe(true);
  });

  it('is, when the backend cannot vouch for the number', () => {
    // An owner-typed walk-in whose WhatsApp invite failed and went out by email.
    expect(needsPhoneOtp({ enteredPhone: TYPED, trust: untrusted })).toBe(true);
  });

  it('is, when the context says nothing about trust at all', () => {
    // Fail closed: an older backend, or a context that failed to load the
    // field, must not silently skip verification.
    expect(needsPhoneOtp({ enteredPhone: TYPED, trust: null })).toBe(true);
    expect(needsPhoneOtp({ enteredPhone: TYPED, trust: undefined })).toBe(true);
  });

  it('is, when trust is claimed but no number is named', () => {
    expect(needsPhoneOtp({ enteredPhone: TYPED, trust: { phone: null, trusted: true } })).toBe(true);
  });
});

describe('whether Identity can be submitted', () => {
  it('can, with no code at all, for a trusted unedited number', () => {
    expect(canSubmitIdentity({ enteredPhone: TYPED, trust: trusted, otp: '', otpSent: false })).toBe(true);
  });

  it('cannot, on an edited number, until a complete code has been sent', () => {
    const editing = { enteredPhone: DIFFERENT, trust: trusted };
    expect(canSubmitIdentity({ ...editing, otp: '', otpSent: false })).toBe(false);
    expect(canSubmitIdentity({ ...editing, otp: '1234', otpSent: true })).toBe(false);
    expect(canSubmitIdentity({ ...editing, otp: '123456', otpSent: false })).toBe(false);
    expect(canSubmitIdentity({ ...editing, otp: '123456', otpSent: true })).toBe(true);
  });

  it('cannot, on an incomplete number, however trusted the invitation was', () => {
    expect(canSubmitIdentity({ enteredPhone: '90000', trust: trusted, otp: '', otpSent: false })).toBe(false);
  });
});
