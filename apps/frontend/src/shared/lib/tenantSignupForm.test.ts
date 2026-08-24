import { describe, it, expect } from 'vitest';
import {
  MAX_SIGNUP_PASSWORD_LENGTH,
  MIN_SIGNUP_PASSWORD_LENGTH,
  toTenantSignupPayload,
  validateTenantSignup,
  type TenantSignupFields,
} from './tenantSignupForm';

const valid: TenantSignupFields = {
  name: 'Riya Sharma',
  email: 'riya@example.com',
  password: 'correct-horse',
  confirmPassword: 'correct-horse',
};

describe('validateTenantSignup', () => {
  it('accepts a filled-in form', () => {
    const result = validateTenantSignup(valid);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.firstError).toBeNull();
  });

  it('names every empty field rather than a single generic complaint', () => {
    const result = validateTenantSignup({ name: '', email: '', password: '', confirmPassword: '' });
    expect(Object.keys(result.errors).sort()).toEqual(['email', 'name', 'password']);
    expect(result.valid).toBe(false);
  });

  it('surfaces the topmost field first, in the order the form shows them', () => {
    const result = validateTenantSignup({ ...valid, name: '', email: 'nope' });
    expect(result.firstError).toBe(result.errors.name);
  });

  it('treats whitespace as empty', () => {
    expect(validateTenantSignup({ ...valid, name: '   ' }).errors.name).toBeTruthy();
    expect(validateTenantSignup({ ...valid, email: '  ' }).errors.email).toBeTruthy();
  });

  it('rejects a one-character name but accepts a two-character one', () => {
    expect(validateTenantSignup({ ...valid, name: 'R' }).errors.name).toBeTruthy();
    expect(validateTenantSignup({ ...valid, name: 'Jo' }).valid).toBe(true);
  });

  it('rejects addresses that are not addresses', () => {
    for (const email of ['riya', 'riya@', '@example.com', 'riya@example', 'a b@example.com']) {
      expect(validateTenantSignup({ ...valid, email }).errors.email).toBeTruthy();
    }
  });

  it('accepts an email with surrounding whitespace, since it is trimmed', () => {
    expect(validateTenantSignup({ ...valid, email: '  riya@example.com ' }).valid).toBe(true);
  });

  it('enforces the same password bounds the backend does', () => {
    const short = 'a'.repeat(MIN_SIGNUP_PASSWORD_LENGTH - 1);
    expect(validateTenantSignup({ ...valid, password: short, confirmPassword: short }).errors.password).toBeTruthy();

    const exact = 'a'.repeat(MIN_SIGNUP_PASSWORD_LENGTH);
    expect(validateTenantSignup({ ...valid, password: exact, confirmPassword: exact }).valid).toBe(true);

    const long = 'a'.repeat(MAX_SIGNUP_PASSWORD_LENGTH + 1);
    expect(validateTenantSignup({ ...valid, password: long, confirmPassword: long }).errors.password).toBeTruthy();
  });

  it('rejects a confirmation that differs, including by case or trailing space', () => {
    expect(validateTenantSignup({ ...valid, confirmPassword: 'Correct-horse' }).errors.confirmPassword).toBeTruthy();
    expect(validateTenantSignup({ ...valid, confirmPassword: 'correct-horse ' }).errors.confirmPassword).toBeTruthy();
    expect(validateTenantSignup({ ...valid, confirmPassword: '' }).errors.confirmPassword).toBeTruthy();
  });

  // Saying "passwords don't match" while the first one is still too short sends
  // someone to fix the wrong field.
  it('stays quiet about the confirmation while the password itself is unusable', () => {
    const result = validateTenantSignup({ ...valid, password: 'short', confirmPassword: '' });
    expect(result.errors.password).toBeTruthy();
    expect(result.errors.confirmPassword).toBeUndefined();
  });
});

describe('toTenantSignupPayload', () => {
  it('trims the name, lowercases the email, and sends the password untouched', () => {
    expect(
      toTenantSignupPayload({
        name: '  Riya Sharma  ',
        email: '  Riya@Example.COM ',
        password: ' spaces are real ',
        confirmPassword: ' spaces are real ',
      }),
    ).toEqual({
      name: 'Riya Sharma',
      email: 'riya@example.com',
      password: ' spaces are real ',
    });
  });

  // No phone: the number is asked for at enquiry time (ADR-096/ADR-078), and
  // sending an empty one would trip the backend's OTP gate.
  it('never sends a phone', () => {
    expect(toTenantSignupPayload(valid)).not.toHaveProperty('phone');
  });
});
