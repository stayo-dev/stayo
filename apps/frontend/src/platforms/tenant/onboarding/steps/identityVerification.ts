/**
 * What the Identity screen still has to ask for.
 *
 * The screen used to ask every invitee to OTP their mobile and retype their
 * email, regardless of what we already held. For someone invited off a Stayo
 * Discover enquiry that was all redundant — they had verified the number at
 * enquiry time, we had just WhatsApp'd the invitation link to it, and the email
 * they retyped was the one their own account already used, which the backend
 * then rejected as "already registered".
 *
 * The rule now: **we do not re-ask for what we already have, and we do not
 * re-verify what has already been proven.** The one thing that re-arms
 * verification is the invitee changing the number, because then it is a number
 * nothing was ever sent to.
 */

/** Digits only, so "+91 90000 00000" and "9000000000" compare equal. */
export function phoneDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Compare two numbers as the same person would: by the last 10 digits, so a
 * `91`-prefixed invitation number matches what is typed into a `+91` field.
 */
export function isSamePhone(a: unknown, b: unknown): boolean {
  const left = phoneDigits(a).slice(-10);
  const right = phoneDigits(b).slice(-10);
  return left.length === 10 && left === right;
}

export type PhoneTrust = {
  /** The number the invitation was addressed to. */
  phone: string | null;
  /** Whether the backend can already vouch for that number. */
  trusted: boolean;
};

/**
 * Whether the invitee must enter an OTP before Identity can be submitted.
 *
 * Untrusted from the start — an owner-typed walk-in whose WhatsApp invite never
 * landed — means asking, exactly as before. Trusted means not asking, until and
 * unless they edit the number.
 */
export function needsPhoneOtp(input: { enteredPhone: unknown; trust: PhoneTrust | null | undefined }): boolean {
  const trust = input.trust;
  if (!trust?.trusted || !trust.phone) return true;
  return !isSamePhone(input.enteredPhone, trust.phone);
}

/**
 * Whether Identity can be submitted.
 *
 * A trusted, unedited number needs nothing. Anything else needs a complete
 * 6-digit code that has actually been sent.
 */
export function canSubmitIdentity(input: {
  enteredPhone: unknown;
  trust: PhoneTrust | null | undefined;
  otp: string;
  otpSent: boolean;
}): boolean {
  if (phoneDigits(input.enteredPhone).length < 10) return false;
  if (!needsPhoneOtp({ enteredPhone: input.enteredPhone, trust: input.trust })) return true;
  return input.otpSent && input.otp.length === 6;
}
