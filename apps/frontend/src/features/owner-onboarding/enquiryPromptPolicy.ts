/**
 * Decides whether the "Are you a hostel owner?" prompt should appear.
 *
 * Pure and separated from the component so the rules — which are the part
 * that is easy to get wrong and annoying when wrong — are testable in the
 * node-only test environment (`apps/frontend` has no jsdom).
 *
 * There is deliberately **no persistent dismissal**. An earlier version stored
 * a 7-day cooldown in localStorage; it was removed because on a pre-launch
 * marketing page the cost of re-asking a visitor is far lower than the cost of
 * silently never asking again — and because an invisible stored timestamp made
 * the feature look broken to everyone testing it. Dismissing now hides the
 * prompt for the current page view only.
 */

/** Fires once the visitor is past the hero, which is genuine interest rather than a bounce. */
export const ENQUIRY_PROMPT_SCROLL_THRESHOLD = 0.4;

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
  /** An authenticated owner who already has a hostel is not a lead. */
  isOwnerWithHostel: boolean;
  alreadyShownThisSession: boolean;
};

/**
 * Why the prompt is not showing, or `null` if it should show.
 *
 * Exists because the remaining suppression rules are invisible from the
 * outside — a signed-in owner looks identical to "the feature is broken".
 * The component logs this in development.
 */
export function explainEnquiryPromptSuppression(input: EnquiryPromptInput): string | null {
  if (input.isOwnerWithHostel) {
    return 'suppressed: signed in as an owner who already has a hostel — sign out to see it';
  }
  if (input.alreadyShownThisSession) {
    return 'suppressed: already shown once on this page view — reload to see it again';
  }
  if (input.scrollFraction < ENQUIRY_PROMPT_SCROLL_THRESHOLD) {
    return `waiting: scrolled ${(input.scrollFraction * 100).toFixed(0)}% of ${(
      ENQUIRY_PROMPT_SCROLL_THRESHOLD * 100
    ).toFixed(0)}% needed`;
  }
  return null;
}

export function shouldShowEnquiryPrompt(input: EnquiryPromptInput): boolean {
  return explainEnquiryPromptSuppression(input) === null;
}
