/**
 * When to offer the owner the option of keeping a tenant's records themselves.
 *
 * Pure so it can be tested — this repo's frontend tests are node-only, so the
 * decision lives here and the sheet just renders it.
 */
const QUIET_DAYS = 7;

export interface InvitationQuietness {
  /**
   * Intentionally not read by `shouldOfferAdoption` below. An invite the
   * tenant opened but never finished is still a legitimate adoption
   * candidate — clicking the link doesn't mean they're coming back — so
   * quietness is judged purely on `sentDaysAgo`. Kept on the interface
   * because callers have the real value and passing it documents that this
   * was a deliberate choice, not an oversight. See the "opened but never
   * finished" case in `adoptPrompt.test.ts`.
   */
  openedAt: string | null;
  sentDaysAgo: number;
}

export function shouldOfferAdoption(invitation: InvitationQuietness): boolean {
  return invitation.sentDaysAgo >= QUIET_DAYS;
}

/** Neutral by design: the tenant is not at fault, and the owner is not stuck. */
export function adoptionPromptText(name: string, days: number): string {
  const dayWord = days === 1 ? 'day' : 'days';
  return `${name} hasn't opened this invite in ${days} ${dayWord}. You can keep their records yourself and invite them again anytime.`;
}
