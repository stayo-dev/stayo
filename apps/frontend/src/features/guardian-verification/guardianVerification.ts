/**
 * What the tenant is shown about guardian verification, and how insistently.
 *
 * ## The rule this module encodes
 *
 * **Make the good path the easy path, make the skip honest, and never make the
 * skip feel like defeat.**
 *
 * Verification used to be a wall with no door: a tenant standing at the
 * reception desk could not finish onboarding until a parent — asleep,
 * travelling, or just not answering — read a six-digit code back to them.
 * ADR-212 opened the door. The risk in opening it is that everybody walks
 * through, so what replaces the wall is a sequence of small, honest pressures:
 * a named guardian, a dated promise, a nearly-complete progress bar, and a
 * prompt that backs off rather than escalates.
 *
 * ## Why the copy lives here and not in the components
 *
 * This app's test suite is node-only — no jsdom, no component rendering — so
 * anything that decides *what to say* has to be a pure module to be testable at
 * all. That constraint happens to be right here: the wording is the feature.
 *
 * PURE — no React, no DOM.
 */

export type GuardianVerificationState =
  | 'NOT_APPLICABLE'
  | 'VERIFIED'
  | 'PENDING_UNCHASED'
  | 'PENDING_GRACE'
  | 'PENDING_OVERDUE';

export interface GuardianBadge {
  label: string;
  /**
   * `neutral` in an OPTIONAL hostel, `warning` in a MANDATORY one. Never
   * `danger`: a parent who has not tapped a button has done nothing wrong, and
   * a red badge on an owner's screen would say otherwise about a person who
   * never agreed to be on it.
   */
  tone: 'success' | 'warning' | 'neutral';
  /** Whether the badge itself should offer an action. */
  actionable: boolean;
}

export function guardianBadge(state: GuardianVerificationState): GuardianBadge | null {
  switch (state) {
    case 'NOT_APPLICABLE':
      return null;
    case 'VERIFIED':
      return { label: 'Verified', tone: 'success', actionable: false };
    case 'PENDING_UNCHASED':
      // Factual, quiet, no call to action. This hostel has decided it does not
      // chase this, and a badge that nags anyway would be the product
      // overruling the owner.
      return { label: 'Not verified', tone: 'neutral', actionable: false };
    case 'PENDING_GRACE':
    case 'PENDING_OVERDUE':
      return { label: 'Not verified', tone: 'warning', actionable: true };
  }
}

/** A date the tenant can hold us to: "23 Sep". */
export function formatGuardianDeadline(deadline: string | Date | null | undefined): string | null {
  if (!deadline) return null;
  const date = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export interface GuardianPromptCopy {
  title: string;
  body: string;
  /** The action we actually want taken. */
  primaryAction: string;
  /** The way out. Always present, never hidden, never delayed. */
  secondaryAction: string;
}

/**
 * What the tenant reads when we ask.
 *
 * Note what the overdue copy leads with: what the *guardian* gains. The hostel's
 * interest in verification is real but it is not the tenant's, and a prompt
 * that opens with an institutional demand invites the reader to treat it as
 * somebody else's problem. "Your mother can see and pay your rent from
 * WhatsApp" is a reason the reader actually has.
 */
export function guardianPromptCopy(
  state: GuardianVerificationState,
  guardianName: string | null | undefined,
  deadline: string | Date | null | undefined,
): GuardianPromptCopy | null {
  const who = String(guardianName || '').trim() || 'your guardian';
  const by = formatGuardianDeadline(deadline);

  switch (state) {
    case 'PENDING_GRACE':
      return {
        title: `Confirm ${who}'s number`,
        body: by
          ? `One tap from them and it's done. We'll ask again on ${by}.`
          : `One tap from them and it's done — no code to read out.`,
        primaryAction: `Ask ${who} to confirm`,
        secondaryAction: 'I have the code',
      };
    case 'PENDING_OVERDUE':
      return {
        title: `${who} hasn't confirmed yet`,
        body: `Once they do, they can see your rent, pay it for you, and be reached if anything happens. It takes them one tap.`,
        primaryAction: `Ask ${who} to confirm`,
        secondaryAction: 'Not now',
      };
    case 'PENDING_UNCHASED':
      return {
        title: `${who}'s number isn't verified`,
        body: `You can confirm it whenever you like — there's no rush.`,
        primaryAction: `Ask ${who} to confirm`,
        secondaryAction: 'Later',
      };
    default:
      return null;
  }
}

/**
 * The reasons a tenant can give for deferring, in the order they are offered.
 *
 * Asking at all is the point. A skip that costs one honest tap makes the person
 * name the obstacle, which is both a small act of ownership and the only way
 * the owner ever learns that a parent has no WhatsApp — the case no amount of
 * reminding will fix, and the one a phone call solves in a minute.
 */
export const GUARDIAN_DEFERRAL_REASONS = [
  { value: 'NOT_REACHABLE_NOW', label: "They're not reachable right now" },
  { value: 'TRAVELLING', label: "They're travelling" },
  { value: 'NO_WHATSAPP', label: "They don't use WhatsApp" },
  { value: 'PREFER_NOT_TO', label: "I'd rather not" },
] as const;

export type GuardianDeferralReason = (typeof GUARDIAN_DEFERRAL_REASONS)[number]['value'];

/**
 * What we say back when someone defers.
 *
 * Always names the date. An open-ended "we'll remind you" is more aversive than
 * a specific one: it leaves the reader with an unbounded obligation, while a
 * date turns it into a diary entry they can stop thinking about. It is also
 * simply true, which is the better reason.
 */
export function guardianDeferralAcknowledgement(
  deadline: string | Date | null | undefined,
  chased: boolean,
): string {
  if (!chased) return "No problem — you can confirm it any time from your profile.";
  const by = formatGuardianDeadline(deadline);
  return by
    ? `No problem — we'll ask again on ${by}.`
    : "No problem — we'll remind you in a week.";
}
