import { describe, it, expect } from 'vitest';
import {
  PASSWORD_CRITERIA,
  evaluatePassword,
  MIN_PASSWORD_LENGTH,
} from './passwordPolicy';

describe('password criteria', () => {
  it('states every rule up front, so nothing is discovered only on failure', () => {
    expect(PASSWORD_CRITERIA.map((c) => c.id)).toEqual(['length', 'letter', 'number', 'special']);
    PASSWORD_CRITERIA.forEach((c) => expect(c.label.length).toBeGreaterThan(0));
  });

  it('marks nothing as met for an empty password', () => {
    const result = evaluatePassword('');
    expect(result.met).toEqual([]);
    expect(result.allMet).toBe(false);
    expect(result.strength).toBe('empty');
  });

  it('ticks each criterion independently as it is satisfied', () => {
    expect(evaluatePassword('abcdefgh').met).toEqual(['length', 'letter']);
    expect(evaluatePassword('abcdefg1').met).toEqual(['length', 'letter', 'number']);
    expect(evaluatePassword('abcdefg!').met).toEqual(['length', 'letter', 'special']);
    expect(evaluatePassword('Shiva@123').met).toEqual(['length', 'letter', 'number', 'special']);
  });

  it('does not count a short password as meeting the length rule', () => {
    expect(evaluatePassword('Ab@1').met).not.toContain('length');
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(8);
  });

  it('only reports allMet when every criterion passes', () => {
    expect(evaluatePassword('abcdefg1').allMet).toBe(false);
    expect(evaluatePassword('Shiva@123').allMet).toBe(true);
  });

  // The point of the checklist is to tell someone what is still missing while
  // they type, not to make them guess after a rejection.
  it('names what is still missing', () => {
    expect(evaluatePassword('abcdefgh').missing).toEqual(['number', 'special']);
    expect(evaluatePassword('Shiva@123').missing).toEqual([]);
  });

  it('grades strength from weak to strong as criteria accumulate', () => {
    expect(evaluatePassword('abc').strength).toBe('weak');
    expect(evaluatePassword('abcdefgh').strength).toBe('fair');
    expect(evaluatePassword('abcdefg1').strength).toBe('good');
    expect(evaluatePassword('Shiva@123').strength).toBe('strong');
  });

  // A long passphrase with no digits or symbols is genuinely strong; refusing
  // it would push people toward "Password1!" instead.
  it('accepts a long passphrase as strong even without a digit or symbol', () => {
    const result = evaluatePassword('correct horse battery staple');
    expect(result.strength).toBe('strong');
    expect(result.allMet).toBe(true);
  });

  it('treats a space as a valid special character', () => {
    expect(evaluatePassword('abcdefg 1').met).toContain('special');
  });

  it('never throws on odd input', () => {
    expect(() => evaluatePassword('🔐🔐🔐🔐🔐🔐🔐🔐')).not.toThrow();
    expect(() => evaluatePassword(undefined as unknown as string)).not.toThrow();
  });
});
