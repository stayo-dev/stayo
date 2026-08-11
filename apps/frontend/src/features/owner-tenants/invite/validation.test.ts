import { describe, it, expect } from 'vitest';
import {
  sanitizeIndianPhone,
  isValidIndianPhone,
  isValidTenantEmail,
  isValidTenantName,
} from './validation';

describe('Tenant Invitation Validation Utilities', () => {
  describe('sanitizeIndianPhone', () => {
    it('returns empty string for null, undefined, or empty input', () => {
      expect(sanitizeIndianPhone(null)).toBe('');
      expect(sanitizeIndianPhone(undefined)).toBe('');
      expect(sanitizeIndianPhone('')).toBe('');
    });

    it('strips non-digit characters', () => {
      expect(sanitizeIndianPhone('+91 80080-46952')).toBe('8008046952');
      expect(sanitizeIndianPhone('(987) 654-3210')).toBe('9876543210');
    });

    it('removes +91 or 91 prefix when length exceeds 10', () => {
      expect(sanitizeIndianPhone('+918008046952')).toBe('8008046952');
      expect(sanitizeIndianPhone('918008046952')).toBe('8008046952');
      expect(sanitizeIndianPhone('0918008046952')).toBe('8008046952');
    });

    it('removes leading 0 when length exceeds 10', () => {
      expect(sanitizeIndianPhone('08008046952')).toBe('8008046952');
    });

    it('caps phone digits at 10 characters', () => {
      expect(sanitizeIndianPhone('98765432109999')).toBe('9876543210');
    });
  });

  describe('isValidIndianPhone', () => {
    it('validates 10-digit Indian numbers starting with 6, 7, 8, or 9', () => {
      expect(isValidIndianPhone('9876543210')).toBe(true);
      expect(isValidIndianPhone('8008046952')).toBe(true);
      expect(isValidIndianPhone('7000000000')).toBe(true);
      expect(isValidIndianPhone('6300000000')).toBe(true);
      expect(isValidIndianPhone('+918008046952')).toBe(true);
    });

    it('rejects numbers not starting with 6-9', () => {
      expect(isValidIndianPhone('5000000000')).toBe(false);
      expect(isValidIndianPhone('1234567890')).toBe(false);
      expect(isValidIndianPhone('0000000000')).toBe(false);
    });

    it('rejects numbers shorter or longer than 10 digits', () => {
      expect(isValidIndianPhone('98765')).toBe(false);
      expect(isValidIndianPhone('')).toBe(false);
      expect(isValidIndianPhone(null)).toBe(false);
    });
  });

  describe('isValidTenantEmail', () => {
    it('treats empty/blank email as valid since email is optional', () => {
      expect(isValidTenantEmail('')).toBe(true);
      expect(isValidTenantEmail('   ')).toBe(true);
      expect(isValidTenantEmail(null)).toBe(true);
      expect(isValidTenantEmail(undefined)).toBe(true);
    });

    it('validates correct email formats', () => {
      expect(isValidTenantEmail('tenant@example.com')).toBe(true);
      expect(isValidTenantEmail('user.name+tag@domain.co.in')).toBe(true);
    });

    it('rejects invalid email formats', () => {
      expect(isValidTenantEmail('invalid-email')).toBe(false);
      expect(isValidTenantEmail('tenant@.com')).toBe(false);
      expect(isValidTenantEmail('tenant@domain')).toBe(false);
    });
  });

  describe('isValidTenantName', () => {
    it('requires at least 2 non-whitespace characters', () => {
      expect(isValidTenantName('Rahul')).toBe(true);
      expect(isValidTenantName('  A B  ')).toBe(true);
      expect(isValidTenantName('A')).toBe(false);
      expect(isValidTenantName('   ')).toBe(false);
      expect(isValidTenantName(null)).toBe(false);
    });
  });
});
