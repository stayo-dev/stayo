/**
 * Where to scroll so a field the tenant must fix is actually looked at.
 *
 * The wizard has furniture at both ends — a sticky action bar at the bottom
 * (`StepActionBar`, 108px of reserved padding) and the header band at the top —
 * so "scroll it into view" is not enough: `scrollIntoView` happily parks a
 * field under the action bar, where it reads as missing.
 *
 * The field is placed a third of the way down the free space rather than at
 * the very top: a form control with its label above it and its message below
 * needs its surroundings visible to make sense, and a little space above it
 * signals there is content up there rather than the page having jumped to a
 * hard edge.
 */

export type RevealInput = {
  /** The field's position relative to the document (rect.top + current scrollY). */
  fieldTop: number;
  fieldHeight: number;
  viewportHeight: number;
  /** Current scroll position, returned unchanged when the field already sits comfortably. */
  scrollY: number;
  /** Space taken at the top of the viewport (the sticky error summary, when shown). */
  topInset: number;
  /** Space taken at the bottom (the action bar). */
  bottomInset: number;
  /** Furthest the page can scroll. */
  maxScroll: number;
};

/** Fraction of the free space to leave above the field. */
const REST_POINT = 1 / 3;

export function revealScrollTop(input: RevealInput): number {
  const free = Math.max(0, input.viewportHeight - input.topInset - input.bottomInset);

  // A field taller than the free space (a document row with its message, a
  // signature pad) is pinned just below the top inset instead — showing its
  // start matters more than centring it.
  const offset = input.fieldHeight >= free ? input.topInset : input.topInset + Math.max(0, (free - input.fieldHeight) * REST_POINT);

  const desired = input.fieldTop - offset;
  return Math.max(0, Math.min(desired, input.maxScroll));
}

/**
 * Whether the field is already fully visible between the insets. Scrolling a
 * field the tenant is already looking at is disorienting — the page moves for
 * no reason they can see.
 */
export function isComfortablyVisible(input: RevealInput): boolean {
  const top = input.fieldTop - input.scrollY;
  const bottom = top + input.fieldHeight;
  return top >= input.topInset && bottom <= input.viewportHeight - input.bottomInset;
}
