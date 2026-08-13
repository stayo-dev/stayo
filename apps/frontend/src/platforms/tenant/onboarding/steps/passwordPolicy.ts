/**
 * Password strength meter for the tenant activation flow's password step.
 *
 * Ported as-is from the frozen `portal/pages/ActivateAccountPage.tsx`'s
 * `passwordStrength()` — same scoring (length/uppercase/digit/symbol) and
 * labels, just relocated so `PasswordActivateStep` can import it directly.
 */

export type PasswordStrengthResult = {
  label: 'Weak' | 'Fair' | 'Good' | 'Strong';
  width: string;
  color: string;
  textColor: string;
};

export function passwordStrength(password: string): PasswordStrengthResult {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 1) return { label: 'Weak', width: '25%', color: 'bg-red-500', textColor: 'text-red-700' };
  if (score === 2) return { label: 'Fair', width: '50%', color: 'bg-amber-500', textColor: 'text-amber-700' };
  if (score === 3) return { label: 'Good', width: '75%', color: 'bg-lime-500', textColor: 'text-lime-700' };
  return { label: 'Strong', width: '100%', color: 'bg-emerald-500', textColor: 'text-emerald-700' };
}
