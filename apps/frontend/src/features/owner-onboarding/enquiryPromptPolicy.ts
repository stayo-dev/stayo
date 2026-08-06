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

export type ScrollGeometry = {
  /** Scroll offset of whichever element actually scrolls. */
  scrollTop: number;
  /** Full height of the scrolling content. */
  contentHeight: number;
  viewportHeight: number;
};

/**
 * How far down the page the visitor is, as 0..1.
 *
 * Kept separate from the DOM reads in `OwnerEnquiryPrompt` so the arithmetic
 * is testable in the node-only environment. The caller is responsible for
 * measuring the *real* scroller — on this app that is `<body>`, not
 * `document.documentElement`: `theme.css` sets `overflow-x: hidden` on both
 * html and body, and per CSS spec a hidden value on one axis forces the other
 * from `visible` to `auto`. Measured on the live landing page,
 * `documentElement.scrollHeight` was 437 (exactly the viewport) while
 * `body.scrollHeight` was 5101, which is why a documentElement-based
 * measurement is pinned at 0 no matter how far the user scrolls.
 */
export function computeScrollFraction(geometry: ScrollGeometry): number {
  const { scrollTop, contentHeight, viewportHeight } = geometry;
  if (!Number.isFinite(scrollTop) || !Number.isFinite(contentHeight) || !Number.isFinite(viewportHeight)) {
    return 0;
  }
  const scrollable = contentHeight - viewportHeight;
  if (scrollable <= 0) return 0;
  return Math.min(1, Math.max(0, scrollTop / scrollable));
}

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
