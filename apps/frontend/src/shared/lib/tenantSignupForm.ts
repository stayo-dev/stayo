/**
 * Rules for the Sign Up tab of `shared/ui-patterns/LoginModal` (ADR-096).
 *
 * Signing up is name + email + password + confirm password — no phone. The
 * number is asked for once, at the moment it's actually needed (sending an
 * enquiry), which is where ADR-078 moved it and where a Google-created account
 * already gets it.
 *
 * The rules live here rather than inside the component for the reason every
 * pure module in this app does: `apps/frontend` tests run in a node
 * environment with no jsdom, so validation is directly testable and the modal
 * stays a renderer. They mirror `TenantSignupSchema` in the backend
 * (`apps/backend/lib/validators/index.ts`) — the server is still the authority;
 * this exists so someone isn't told what they got wrong only by a round trip.
 */

export const MIN_SIGNUP_NAME_LENGTH = 2;
export const MIN_SIGNUP_PASSWORD_LENGTH = 8;
/** Matches the backend's `z.string().min(8).max(64)`. */
export const MAX_SIGNUP_PASSWORD_LENGTH = 64;

export interface TenantSignupFields {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export type TenantSignupField = keyof TenantSignupFields;

export type TenantSignupErrors = Partial<Record<TenantSignupField, string>>;

export interface TenantSignupValidation {
  errors: TenantSignupErrors;
  valid: boolean;
  /** The message to surface first — fields in the order they're shown. */
  firstError: string | null;
}

const FIELD_ORDER: TenantSignupField[] = ['name', 'email', 'password', 'confirmPassword'];

// Deliberately loose: the same "something@something.something" shape the input's
// own `type="email"` accepts. Anything stricter rejects real addresses, and the
// backend's zod check is the one that actually gates the account.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateTenantSignup(fields: TenantSignupFields): TenantSignupValidation {
  const errors: TenantSignupErrors = {};

  const name = fields.name.trim();
  if (!name) errors.name = 'Please enter your name.';
  else if (name.length < MIN_SIGNUP_NAME_LENGTH) errors.name = 'Please enter your full name.';

  const email = fields.email.trim();
  if (!email) errors.email = 'Please enter your email.';
  else if (!EMAIL_PATTERN.test(email)) errors.email = "That doesn't look like an email address.";

  if (!fields.password) errors.password = 'Please choose a password.';
  else if (fields.password.length < MIN_SIGNUP_PASSWORD_LENGTH) {
    errors.password = `Use at least ${MIN_SIGNUP_PASSWORD_LENGTH} characters.`;
  } else if (fields.password.length > MAX_SIGNUP_PASSWORD_LENGTH) {
    errors.password = `Keep it under ${MAX_SIGNUP_PASSWORD_LENGTH} characters.`;
  }

  // Only worth saying once the password itself is usable — telling someone the
  // two don't match while they're still typing the first one is noise.
  if (!errors.password) {
    if (!fields.confirmPassword) errors.confirmPassword = 'Please re-enter your password.';
    else if (fields.confirmPassword !== fields.password) errors.confirmPassword = "Passwords don't match.";
  }

  const firstErrorField = FIELD_ORDER.find((field) => errors[field]);

  return {
    errors,
    valid: firstErrorField === undefined,
    firstError: firstErrorField ? errors[firstErrorField]! : null,
  };
}

/** The exact payload `AuthContext.signUpTenant()` should be handed. */
export function toTenantSignupPayload(fields: TenantSignupFields) {
  return {
    name: fields.name.trim(),
    email: fields.email.trim().toLowerCase(),
    password: fields.password,
  };
}
