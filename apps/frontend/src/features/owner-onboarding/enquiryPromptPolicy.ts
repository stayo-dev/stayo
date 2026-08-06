/**
 * Decides whether the "Are you a hostel owner?" prompt should appear.
 *
 * Pure and separated from the component so the rules — which are the part
 * that is easy to get wrong and annoying when wrong — are testable in the
 * node-only test environment (`apps/frontend` has no jsdom).
 */

/** Fires once the visitor is past the hero, which is genuine interest rather than a bounce. */
export const ENQUIRY_PROMPT_SCROLL_THRESHOLD = 0.4;

/** A dismissal is respected for 7 days. */
export const ENQUIRY_PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export const ENQUIRY_PROMPT_DISMISS_KEY = 'stayo.enquiryPrompt.dismissedAt';

export type EnquiryPromptInput = {
  scrollFraction: number;
  /** Epoch ms from localStorage, or null if never dismissed. May be NaN if the stored value was corrupt. */
  dismissedAt: number | null;
  /** An authenticated owner who already has a hostel is not a lead. */
  isOwnerWithHostel: boolean;
  alreadyShownThisSession: boolean;
  now: number;
};

export function shouldShowEnquiryPrompt(input: EnquiryPromptInput): boolean {
  if (input.isOwnerWithHostel) return false;
  if (input.alreadyShownThisSession) return false;
  if (input.scrollFraction < ENQUIRY_PROMPT_SCROLL_THRESHOLD) return false;

  const dismissedAt = input.dismissedAt;
  if (dismissedAt !== null && Number.isFinite(dismissedAt)) {
    const elapsed = input.now - dismissedAt;
    // A future timestamp means a corrupt or clock-skewed value — treat it as
    // no dismissal rather than suppressing the prompt indefinitely.
    if (elapsed >= 0 && elapsed <= ENQUIRY_PROMPT_COOLDOWN_MS) return false;
  }

  return true;
}
