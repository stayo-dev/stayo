/**
 * The onboarding email step, decided in one place.
 *
 * A tenant invited by phone alone used to finish onboarding with
 * `<phone>@hms.temp` as their login. The Identity screen now asks for a real
 * address and proves it with a code before the account can be set up — except
 * for someone who already signs in with a real address of their own, whom the
 * server marks `required: false`. The server is the authority (the ACCOUNT
 * step refuses without a verification); this module only keeps the screen in
 * step with it, so the button is never enabled for a submission the server
 * will reject.
 */

export interface EmailRequirement {
  required: boolean;
  /** Prefill: a verified address, or one the owner typed. Null when there is none. */
  email: string | null;
  /** The address this invitation already proved, if any — survives a reload. */
  verified_email: string | null;
}

export function normalizeEmail(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase();
}

/** Plain on purpose — the code arriving is the real test of an address. */
export function looksLikeEmail(raw: string | null | undefined): boolean {
  const email = normalizeEmail(raw);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.endsWith('@hms.temp');
}

/**
 * Whether the address in the box is the one that was proved. Editing it after
 * verifying un-proves it: the code was for the old address.
 */
export function isEmailVerified(entered: string, verifiedAs: string | null): boolean {
  return Boolean(verifiedAs) && normalizeEmail(entered) === normalizeEmail(verifiedAs);
}

/** Whether the Identity screen may be submitted, as far as the email goes. */
export function emailAllowsSubmit(requirement: EmailRequirement | null | undefined, entered: string, verifiedAs: string | null): boolean {
  if (!requirement?.required) return true;
  return isEmailVerified(entered, verifiedAs);
}

export type EmailFieldPhase = 'enter' | 'code' | 'verified';

export function emailFieldPhase(input: { entered: string; verifiedAs: string | null; codeSentTo: string | null }): EmailFieldPhase {
  if (isEmailVerified(input.entered, input.verifiedAs)) return 'verified';
  // A code only counts for the address it went to.
  if (input.codeSentTo && normalizeEmail(input.codeSentTo) === normalizeEmail(input.entered)) return 'code';
  return 'enter';
}

/** The line under the field, in each phase. */
export function emailHelperText(phase: EmailFieldPhase, sentTo: string | null): string {
  if (phase === 'verified') return 'Confirmed. You’ll sign in with this and get your receipts here.';
  if (phase === 'code') return `Enter the 6-digit code we sent to ${sentTo}. Check spam if it isn’t there in a minute.`;
  return 'We’ll send a code to confirm it. You’ll use this email to sign in.';
}
