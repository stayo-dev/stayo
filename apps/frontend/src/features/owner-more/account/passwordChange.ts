import { passwordStrength, type PasswordStrengthResult } from '@/platforms/tenant/onboarding/steps/passwordPolicy';

/**
 * The rules for changing an owner's password.
 *
 * `POST /auth/change-password` has existed and worked for some time with no
 * caller in the app — the "Change password" row pointed at a menu — so an
 * owner had no way to change their password at all.
 *
 * Scoring is **not** reimplemented here: `passwordStrength` is the same
 * function the tenant activation and claim flows use, so an owner and their
 * tenant are held to one standard and see the same words for it. Only the
 * three-field change form's own rules live here.
 *
 * The 8-character floor matches the backend's, which stays the authority.
 */

const MIN_LENGTH = 8;

export interface PasswordChangeDraft {
  current: string;
  next: string;
  confirm: string;
}

export interface PasswordChangeCheck {
  ok: boolean;
  field?: 'current' | 'next' | 'confirm';
  reason?: string;
}

export function checkPasswordChange(draft: PasswordChangeDraft): PasswordChangeCheck {
  if (!String(draft?.current ?? '')) {
    return { ok: false, field: 'current', reason: 'Enter your current password.' };
  }

  const next = String(draft?.next ?? '');
  if (next.length < MIN_LENGTH) {
    return {
      ok: false,
      field: 'next',
      reason: `Your new password needs at least ${MIN_LENGTH} characters.`,
    };
  }

  if (next === draft.current) {
    // Not a backend rule, but a change that changes nothing is almost always a
    // mis-tap, and reporting it here costs a round trip less than finding out
    // later that the password never moved.
    return { ok: false, field: 'next', reason: 'That is your current password. Choose a different one.' };
  }

  if (next !== String(draft?.confirm ?? '')) {
    return { ok: false, field: 'confirm', reason: 'The two new passwords do not match.' };
  }

  return { ok: true };
}

export interface PasswordStrengthCopy {
  label: string;
  /** A brand-palette hex, so the meter matches the rest of the owner app. */
  tone: string;
}

const TONES: Record<PasswordStrengthResult['label'], string> = {
  Weak: '#B3402F',
  Fair: '#9A6A18',
  Good: '#5C7C4A',
  Strong: '#3F7D58',
};

/** How many more characters are still needed, if any. */
export function describePasswordStrength(password: string): PasswordStrengthCopy {
  const value = String(password ?? '');
  const remaining = MIN_LENGTH - value.length;
  if (remaining > 0) {
    return {
      label: `${remaining} more character${remaining === 1 ? '' : 's'} to go`,
      tone: TONES.Weak,
    };
  }
  const strength = passwordStrength(value);
  return { label: `${strength.label} password`, tone: TONES[strength.label] };
}
