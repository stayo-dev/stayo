/**
 * Utility functions for validating and sanitizing tenant invitation data
 * (Phone, Email, Full Name, etc.).
 */

/**
 * Strips non-digits and removes redundant Indian country code (+91, 91, 091, 0)
 * to ensure the input field contains only the clean 10-digit mobile number.
 */
export function sanitizeIndianPhone(value: string | null | undefined): string {
  if (!value) return '';
  let cleaned = String(value).replace(/\D/g, '');

  if (cleaned.length > 10 && cleaned.startsWith('91')) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.length > 10 && cleaned.startsWith('091')) {
    cleaned = cleaned.slice(3);
  } else if (cleaned.length > 10 && cleaned.startsWith('0')) {
    cleaned = cleaned.slice(1);
  }

  return cleaned.slice(0, 10);
}

/**
 * Checks if a phone number is a valid 10-digit Indian mobile number
 * starting with 6, 7, 8, or 9.
 */
export function isValidIndianPhone(value: string | null | undefined): boolean {
  const digits = sanitizeIndianPhone(value);
  return /^[6-9]\d{9}$/.test(digits);
}

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Checks if email is valid (empty is considered valid since email is optional).
 */
export function isValidTenantEmail(value: string | null | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (trimmed === '') return true;
  return EMAIL_REGEX.test(trimmed);
}

/**
 * Checks if full name is valid (at least 2 non-whitespace characters).
 */
export function isValidTenantName(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.trim().length >= 2;
}
