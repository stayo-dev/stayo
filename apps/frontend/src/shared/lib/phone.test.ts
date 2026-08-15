import { describe, it, expect } from 'vitest';
import { canonicalPhone, formatIndianPhone, isSamePhone, toLocalPhone } from './phone';

describe('toLocalPhone', () => {
  it('strips the country code the backend stores', () => {
    expect(toLocalPhone('+918008046952')).toBe('8008046952');
  });

  it('leaves an already-local number alone', () => {
    expect(toLocalPhone('8008046952')).toBe('8008046952');
  });

  it('ignores spacing and punctuation', () => {
    expect(toLocalPhone('+91 80080-46952')).toBe('8008046952');
    expect(toLocalPhone('091 8008046952')).toBe('8008046952');
  });

  it('returns what it has for an incomplete number', () => {
    expect(toLocalPhone('80080')).toBe('80080');
    expect(toLocalPhone('')).toBe('');
    expect(toLocalPhone(null)).toBe('');
  });
});

describe('formatIndianPhone', () => {
  it('never prints the country code twice', () => {
    expect(formatIndianPhone('+918008046952')).toBe('+91 80080 46952');
    expect(formatIndianPhone('8008046952')).toBe('+91 80080 46952');
  });

  it('is idempotent — formatting formatted output does not accumulate prefixes', () => {
    expect(formatIndianPhone(formatIndianPhone('+918008046952'))).toBe('+91 80080 46952');
  });

  it('passes through anything that is not a full 10-digit number rather than inventing one', () => {
    expect(formatIndianPhone('80080')).toBe('80080');
    expect(formatIndianPhone('')).toBe('');
  });
});

describe('canonicalPhone', () => {
  it('produces the shape the backend stores', () => {
    expect(canonicalPhone('8008046952')).toBe('+918008046952');
    expect(canonicalPhone('+91 80080 46952')).toBe('+918008046952');
  });

  it('refuses numbers that are not valid Indian mobiles', () => {
    expect(canonicalPhone('1234567890')).toBe('');
    expect(canonicalPhone('80080')).toBe('');
    expect(canonicalPhone(null)).toBe('');
  });
});

describe('isSamePhone', () => {
  it('treats stored and typed forms of one number as equal', () => {
    expect(isSamePhone('+918008046952', '8008046952')).toBe(true);
    expect(isSamePhone('+91 80080 46952', '+918008046952')).toBe(true);
  });

  it('still distinguishes different numbers', () => {
    expect(isSamePhone('+918008046952', '9876543210')).toBe(false);
  });
});
