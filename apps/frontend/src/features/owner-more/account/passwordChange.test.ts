import { describe, it, expect } from 'vitest';
import { checkPasswordChange, describePasswordStrength } from './passwordChange';

const draft = (over: Partial<Parameters<typeof checkPasswordChange>[0]> = {}) => ({
  current: 'oldpassword1',
  next: 'newpassword1',
  confirm: 'newpassword1',
  ...over,
});

describe('checkPasswordChange', () => {
  it('accepts a valid change', () => {
    expect(checkPasswordChange(draft())).toEqual({ ok: true });
  });

  it('requires the current password, since the backend verifies it', () => {
    expect(checkPasswordChange(draft({ current: '' }))).toMatchObject({ ok: false, field: 'current' });
  });

  it('holds the new password to the same eight-character floor as the backend', () => {
    expect(checkPasswordChange(draft({ next: 'short1', confirm: 'short1' })))
      .toMatchObject({ ok: false, field: 'next' });
  });

  it('refuses a change that changes nothing', () => {
    // Almost always a mis-tap, and catching it here saves finding out later
    // that the password never moved.
    expect(checkPasswordChange(draft({ next: 'oldpassword1', confirm: 'oldpassword1' })))
      .toMatchObject({ ok: false, field: 'next' });
  });

  it('refuses a mismatched confirmation', () => {
    expect(checkPasswordChange(draft({ confirm: 'newpassword2' })))
      .toMatchObject({ ok: false, field: 'confirm' });
  });

  it('reports one problem at a time', () => {
    const check = checkPasswordChange({ current: '', next: 'x', confirm: 'y' });
    expect(check.field).toBe('current');
  });
});

describe('describePasswordStrength', () => {
  it('counts down the characters still needed rather than just saying weak', () => {
    expect(describePasswordStrength('abc').label).toBe('5 more characters to go');
    expect(describePasswordStrength('abcdefg').label).toBe('1 more character to go');
  });

  it('rates a password once it is long enough', () => {
    // Scoring is the shared `passwordStrength`, so an owner and their tenant
    // are held to one standard and see the same words for it.
    expect(describePasswordStrength('abcdefgh').label).toContain('password');
    expect(describePasswordStrength('Abcdefg1!').label).toBe('Strong password');
  });

  it('gives every state a colour from the brand palette', () => {
    for (const value of ['abc', 'abcdefgh', 'Abcdefg1!']) {
      expect(describePasswordStrength(value).tone).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('survives an empty value', () => {
    expect(describePasswordStrength('').label).toBe('8 more characters to go');
  });
});
