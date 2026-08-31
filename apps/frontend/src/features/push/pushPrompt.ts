/**
 * Whether to show the soft prompt.
 *
 * The browser's own permission dialog is **one-shot**: a "Block" is permanent
 * and reversible only in browser settings, which nobody does. So Stayo asks
 * first, in its own card, at a moment that has already demonstrated the value
 * — and only escalates to the real dialog if the person says yes. A "not now"
 * on our card costs nothing and can be asked again; a "Block" cannot.
 *
 * PURE — no storage, no DOM. Runs under vitest's node environment.
 */
export const PROMPT_COOLDOWN_DAYS = 14;

const KEY_PREFIX = 'stayo_push_prompt_dismissed';

/**
 * Scoped per profile, returning `null` rather than an "anonymous" fallback.
 * A shared key would let one person's dismissal silence the prompt for the
 * next person signing in on the same phone — the ADR-139 failure, which this
 * codebase has already paid for once.
 */
export function promptKey(profileId: string | null | undefined): string | null {
  const id = profileId?.trim();
  return id ? `${KEY_PREFIX}:${id}` : null;
}

export interface OfferInput {
  supported: boolean;
  permission: 'default' | 'granted' | 'denied' | 'unsupported';
  /** When they last said "not now". Null if never. */
  dismissedAt: Date | null;
  now: Date;
}

export function shouldOfferPush({ supported, permission, dismissedAt, now }: OfferInput): boolean {
  if (!supported || permission !== 'default') return false;
  if (!dismissedAt) return true;
  const elapsedDays = (now.getTime() - dismissedAt.getTime()) / 86400_000;
  return elapsedDays >= PROMPT_COOLDOWN_DAYS;
}
