/**
 * Pure decision logic for the "Add Manager" wizard. Mirrors
 * `owners/addOwnerFlow.ts`'s split — API calls and React state stay in the
 * component, this module only validates input and reads known backend error
 * codes. Simpler than Add Owner's wizard: manager creation has no
 * phone-OTP-at-creation-time step (the manager verifies their own phone
 * later, during activation) — `POST /platform-admin/managers` both creates
 * the account AND sends the invitation in one call.
 */
import type { ManagerPermission } from './managerRows';

export type WizardStep = 'details' | 'permissions' | 'review' | 'sent';

export type FieldValidation = { valid: true } | { valid: false; error: string };

export function validateName(name: string): FieldValidation {
  return name.trim().length >= 2 ? { valid: true } : { valid: false, error: "Enter the manager's name." };
}

export function validateEmail(email: string): FieldValidation {
  const trimmed = email.trim();
  if (!trimmed) return { valid: false, error: "Enter the manager's email." };
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
    ? { valid: true }
    : { valid: false, error: 'Enter a valid email address.' };
}

export function validatePhone(phone: string): FieldValidation {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 8 ? { valid: true } : { valid: false, error: 'Enter a valid phone number.' };
}

export type DetailsForm = { name: string; email: string; phone: string };

export function validateDetailsForm(form: DetailsForm): FieldValidation {
  const checks = [validateName(form.name), validateEmail(form.email), validatePhone(form.phone)];
  const firstError = checks.find((c): c is { valid: false; error: string } => !c.valid);
  return firstError ?? { valid: true };
}

const ERROR_MESSAGES: Record<string, string> = {
  ALREADY_EXISTS: 'An account already exists for this email or phone number.',
  INVALID_INPUT: 'Check the details entered and try again.',
  NOT_FOUND: 'That manager could not be found — they may have been removed.',
  ALREADY_ACTIVE: 'This manager has already activated their account.',
};

export function describeAddManagerError(code: string | undefined | null): string {
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  return 'Something went wrong. Please try again.';
}

/** Reads the `{code, message}` shape apiError()/api-client attach to a failed request. */
export function getErrorCode(err: unknown): string | undefined {
  const anyErr = err as any;
  return anyErr?.response?.data?.error?.code;
}

export function togglePermission(current: ManagerPermission[], permission: ManagerPermission): ManagerPermission[] {
  return current.includes(permission) ? current.filter((p) => p !== permission) : [...current, permission];
}
