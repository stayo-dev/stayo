/**
 * The footprints that follow the cursor across Discovery.
 *
 * A brand whose promise is "a hostel that feels like home" can afford one warm
 * flourish, but a search page is a working screen: someone is comparing rents
 * and looking at rooms, and a decoration that competes with a photograph has
 * failed no matter how nice it is. Hence the rules encoded here and the
 * layering decision in `FootprintTrail.tsx` — the prints are painted *behind*
 * every card, so a hostel's photo is never covered by them.
 *
 * PURE — no DOM, runs under vitest's node environment.
 */

/** Pixels of travel between prints. Below this, a footstep is a smear. */
export const STEP_DISTANCE = 78;
/** How far each print sits to the side of the path — the width of a stride. */
export const STRIDE_OFFSET = 9;
/** Never more than this many on screen at once. */
export const MAX_PRINTS = 6;

export interface Footprint {
  id: number;
  x: number;
  y: number;
  /** Degrees, pointing along the direction of travel. */
  angle: number;
  side: 'left' | 'right';
}

/**
 * Whether to run the trail at all.
 *
 * Three ways to say no, and any one of them is final:
 * - a coarse pointer (a phone) has no cursor to follow;
 * - `prefers-reduced-motion` is a person telling us moving decoration makes
 *   the screen harder to use, which outranks a flourish;
 * - a narrow viewport, because the prints live in the page's side margins and
 *   a phone-width layout has none.
 */
export function shouldEnableTrail(input: {
  pointerFine: boolean;
  reducedMotion: boolean;
  viewportWidth: number;
}): boolean {
  return input.pointerFine && !input.reducedMotion && input.viewportWidth >= 1024;
}

/**
 * The next footprint, or null when the cursor has not travelled far enough.
 *
 * Alternating feet are offset perpendicular to the direction of travel, which
 * is what makes a line of prints read as walking rather than as dots.
 */
export function nextFootprint(
  from: { x: number; y: number } | null,
  to: { x: number; y: number },
  previous: Footprint | null,
  id: number,
): Footprint | null {
  if (!from) return null;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < STEP_DISTANCE) return null;

  const side: Footprint['side'] = previous?.side === 'left' ? 'right' : 'left';
  // Unit vector along travel, then its perpendicular, so the offset follows
  // the direction the cursor is actually moving.
  const ux = dx / distance;
  const uy = dy / distance;
  const sign = side === 'left' ? -1 : 1;

  return {
    id,
    x: to.x + -uy * STRIDE_OFFSET * sign,
    y: to.y + ux * STRIDE_OFFSET * sign,
    // Rotate so the toes point the way the cursor went. +90 because the glyph
    // is drawn pointing up.
    angle: (Math.atan2(dy, dx) * 180) / Math.PI + 90,
    side,
  };
}

/** Keeps the trail bounded — the oldest print falls off the end. */
export function trimTrail(prints: Footprint[]): Footprint[] {
  return prints.length > MAX_PRINTS ? prints.slice(prints.length - MAX_PRINTS) : prints;
}
