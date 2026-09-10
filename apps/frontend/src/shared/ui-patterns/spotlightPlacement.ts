/**
 * Where a spotlight's caption goes, given what it is pointing at.
 *
 * Pure — no React, no DOM — so it runs under this app's node-only vitest
 * setup and can be reasoned about without a browser. `Spotlight.tsx` measures
 * the two boxes and does nothing but apply what comes back.
 *
 * The previous version pinned every caption to the middle of the screen with
 * `left-1/2 -translate-x-1/2` and dropped it 12px under the cut-out, falling
 * back to a hard-coded 168px above when that ran off the bottom. On a phone
 * that put the caption over unrelated content as often as not, with nothing
 * tying it to the thing being explained — an owner saw a dimmed screen, a lit
 * card, and a floating panel somewhere else. Following the highlight and
 * pointing at it is the whole difference between a coach mark and a modal.
 */

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export type CaptionSide = 'above' | 'below';

export interface Placement {
  top: number;
  left: number;
  side: CaptionSide;
  /** Arrow tip offset from the caption's own left edge, in px. */
  arrowLeft: number;
}

/** Space between the lit element and the caption, leaving the ring visible. */
export const GAP = 14;
/** Smallest distance the caption may sit from any viewport edge. */
export const EDGE = 12;
/** Keeps the arrow from reaching the caption's rounded corners. */
const ARROW_INSET = 22;

function clamp(value: number, min: number, max: number): number {
  // A viewport narrower than the caption makes min exceed max; honour the
  // left edge in that case rather than returning a negative-width result.
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Places the caption below the highlight when it fits, above when it does
 * not, and on the roomier side when neither is comfortable — a stop anchored
 * to something taller than the screen (a full-height nav, a long card) still
 * has to say something rather than render off-screen.
 */
export function placeCaption({
  highlight,
  caption,
  viewport,
}: {
  highlight: Rect;
  caption: Size;
  viewport: Size;
}): Placement {
  const below = highlight.top + highlight.height + GAP;
  const above = highlight.top - GAP - caption.height;

  const fitsBelow = below + caption.height + EDGE <= viewport.height;
  const fitsAbove = above >= EDGE;

  let side: CaptionSide;
  if (fitsBelow) {
    side = 'below';
  } else if (fitsAbove) {
    side = 'above';
  } else {
    // Neither fits. Compare the room each side actually has.
    const roomBelow = viewport.height - (highlight.top + highlight.height);
    const roomAbove = highlight.top;
    side = roomBelow >= roomAbove ? 'below' : 'above';
  }

  const rawTop = side === 'below' ? below : above;
  const top = clamp(rawTop, EDGE, Math.max(EDGE, viewport.height - caption.height - EDGE));

  const highlightCenter = highlight.left + highlight.width / 2;
  const left = clamp(
    highlightCenter - caption.width / 2,
    EDGE,
    viewport.width - caption.width - EDGE,
  );

  // The arrow tracks the highlight even after the caption has been clamped
  // against an edge — that is exactly when the connection is least obvious
  // and most needed.
  const arrowLeft = clamp(
    highlightCenter - left,
    ARROW_INSET,
    Math.max(ARROW_INSET, caption.width - ARROW_INSET),
  );

  return { top, left, side, arrowLeft };
}

/**
 * Whether the element needs scrolling into view at all.
 *
 * The old tour called `scrollIntoView({ block: 'center' })` on every stop
 * unconditionally, so moving between two stops that were both already visible
 * still jerked the page under the scrim. Scrolling only when something is
 * genuinely off-screen keeps the highlight feeling attached to the page.
 */
export function needsScroll({
  element,
  viewport,
  margin = 24,
}: {
  element: Rect;
  viewport: Size;
  margin?: number;
}): boolean {
  return element.top < margin || element.top + element.height > viewport.height - margin;
}
