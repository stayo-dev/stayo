import { describe, expect, it } from 'vitest';
import {
  emailAllowsSubmit,
  emailFieldPhase,
  emailHelperText,
  isEmailVerified,
  looksLikeEmail,
} from './emailVerification';

const required = { required: true, email: null, verified_email: null };

describe('whether the Identity screen can be submitted', () => {
  /** The server refuses the ACCOUNT step without a proved address. */
  it('waits for a proved email when one is required', () => {
    expect(emailAllowsSubmit(required, 'ravi@gmail.com', null)).toBe(false);
    expect(emailAllowsSubmit(required, 'ravi@gmail.com', 'ravi@gmail.com')).toBe(true);
  });

  it('does not wait for someone who already signs in with their own address', () => {
    expect(emailAllowsSubmit({ required: false, email: 'ravi@gmail.com', verified_email: null }, '', null)).toBe(true);
  });

  /** The code proved the old address, not the new one. */
  it('un-proves an address edited after verifying', () => {
    expect(isEmailVerified('ravi2@gmail.com', 'ravi@gmail.com')).toBe(false);
    expect(emailAllowsSubmit(required, 'ravi2@gmail.com', 'ravi@gmail.com')).toBe(false);
  });

  it('ignores case and spaces when comparing', () => {
    expect(isEmailVerified(' Ravi@Gmail.com ', 'ravi@gmail.com')).toBe(true);
  });
});

describe('the email field', () => {
  it('starts by asking for the address', () => {
    expect(emailFieldPhase({ entered: '', verifiedAs: null, codeSentTo: null })).toBe('enter');
  });

  it('asks for the code once one was sent to this address', () => {
    expect(emailFieldPhase({ entered: 'ravi@gmail.com', verifiedAs: null, codeSentTo: 'ravi@gmail.com' })).toBe('code');
  });

  it('goes back to asking when the address changes after a code was sent', () => {
    expect(emailFieldPhase({ entered: 'other@gmail.com', verifiedAs: null, codeSentTo: 'ravi@gmail.com' })).toBe('enter');
  });

  it('shows confirmed once proved', () => {
    expect(emailFieldPhase({ entered: 'ravi@gmail.com', verifiedAs: 'ravi@gmail.com', codeSentTo: 'ravi@gmail.com' })).toBe(
      'verified'
    );
  });

  it('says where the code went', () => {
    expect(emailHelperText('code', 'ravi@gmail.com')).toContain('ravi@gmail.com');
  });
});

describe('an address worth sending a code to', () => {
  it.each(['ravi@gmail.com', 'a.b@college.ac.in'])('accepts %s', (email) => {
    expect(looksLikeEmail(email)).toBe(true);
  });

  /** The stand-in this whole step replaces. */
  it.each(['+918008046952@hms.temp', 'ravi@', 'ravi', ''])('refuses %s', (email) => {
    expect(looksLikeEmail(email)).toBe(false);
  });
});
