/**
 * Password rules for owner signup, stated up front rather than enforced by
 * rejection.
 *
 * The step previously checked only `length >= 8` and showed a single hint, so
 * an owner learned what was actually required by being refused. Every rule now
 * appears as a checklist that ticks live while they type.
 *
 * Pure and separate from the component: `apps/frontend` tests run in a node
 * environment with no jsdom, so the rules are testable and the step stays a
 * renderer.
 */

export const MIN_PASSWORD_LENGTH = 8;

/** A passphrase this long is strong on entropy alone, without symbol theatre. */
const PASSPHRASE_LENGTH = 20;

export type PasswordCriterionId = 'length' | 'letter' | 'number' | 'special';

export type PasswordCriterion = {
  id: PasswordCriterionId;
  label: string;
  test: (value: string) => boolean;
};

export const PASSWORD_CRITERIA: PasswordCriterion[] = [
  {
    id: 'length',
    label: `At least ${MIN_PASSWORD_LENGTH} characters`,
    test: (v) => v.length >= MIN_PASSWORD_LENGTH,
  },
  { id: 'letter', label: 'A letter', test: (v) => /\p{L}/u.test(v) },
  { id: 'number', label: 'A number', test: (v) => /\d/.test(v) },
  {
    id: 'special',
    label: 'A symbol or space (e.g. ! @ # -)',
    // Anything that is not a letter or a digit, which includes spaces — so a
    // real passphrase counts rather than being told to add punctuation.
    test: (v) => /[^\p{L}\d]/u.test(v),
  },
];

export type PasswordStrength = 'empty' | 'weak' | 'fair' | 'good' | 'strong';

export type PasswordEvaluation = {
  met: PasswordCriterionId[];
  missing: PasswordCriterionId[];
  /** True when the password may be submitted. */
  allMet: boolean;
  strength: PasswordStrength;
};

export function evaluatePassword(rawValue: string): PasswordEvaluation {
  const value = typeof rawValue === 'string' ? rawValue : '';

  const met: PasswordCriterionId[] = [];
  const missing: PasswordCriterionId[] = [];
  for (const criterion of PASSWORD_CRITERIA) {
    (criterion.test(value) ? met : missing).push(criterion.id);
  }

  if (value.length === 0) {
    return { met: [], missing: PASSWORD_CRITERIA.map((c) => c.id), allMet: false, strength: 'empty' };
  }

  // A long passphrase is accepted on length alone. Forcing a digit and a symbol
  // on top of 20+ characters is what produces "Password1!" — worse, not better.
  const isPassphrase = value.length >= PASSPHRASE_LENGTH && met.includes('letter');
  const allMet = isPassphrase || missing.length === 0;

  let strength: PasswordStrength;
  if (allMet) strength = 'strong';
  else if (met.length >= 3) strength = 'good';
  else if (met.length === 2) strength = 'fair';
  else strength = 'weak';

  return {
    met,
    missing: allMet ? [] : missing,
    allMet,
    strength,
  };
}

export const PASSWORD_STRENGTH_LABEL: Record<PasswordStrength, string> = {
  empty: '',
  weak: 'Too weak',
  fair: 'Getting there',
  good: 'Almost there',
  strong: 'Strong enough',
};
