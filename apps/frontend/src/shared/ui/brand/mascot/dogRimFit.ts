/**
 * Where the dog sits relative to the card it leans on, in pixels.
 *
 * The art and the rig live in `.tsx` files this app's node-only test suite
 * cannot render, so the few numbers a *layout* depends on live here, pure and
 * tested. `StayoDog` and `dogParts` read them from here rather than keeping
 * their own copies.
 */

/** The art is authored on a 300-unit-wide square. */
export const DOG_VIEWBOX_WIDTH = 300;

/**
 * The two framings, as `viewBox` y/height within that square. `rim` crops to
 * the part of the dog that shows above a card edge.
 */
export const DOG_VIEWBOX = { rim: { y: 8, h: 218 }, full: { y: 0, h: 300 } } as const;

/** Where the card's top edge crosses the dog in `rim` framing, in art units. */
export const RIM_Y = 214;

/**
 * How far the dog hangs *below* the card's top edge, as a percentage of its own
 * height: the rim line (art y 214) sits 12 units above the bottom of the
 * 218-unit-tall view box. Applied as a `translateY` so the paws straddle the edge.
 */
export const RIM_OVERLAP_PERCENT =
  ((DOG_VIEWBOX.rim.y + DOG_VIEWBOX.rim.h - RIM_Y) / DOG_VIEWBOX.rim.h) * 100;

/** How tall the rim-framed dog renders at a given width. */
export function rimDogHeightPx(widthPx: number): number {
  return (widthPx * DOG_VIEWBOX.rim.h) / DOG_VIEWBOX_WIDTH;
}

/** How much of the dog stands above the card edge — the rest overlaps the card. */
export function rimExposedHeightPx(widthPx: number): number {
  return rimDogHeightPx(widthPx) * (1 - RIM_OVERLAP_PERCENT / 100);
}

/**
 * How far to push a vertically-centred card down so the dog fits above it.
 *
 * A dialog centred on its own leaves `(viewport - card) / 2` of room above it,
 * and the dog needs `rimExposedHeightPx`. On an ordinary laptop window with a
 * tall form that gap is roughly half what the dog needs, so its head is cut off
 * by the top of the window. Moving the card down by half the exposed height
 * centres the card *and* the dog as one unit, which is what the eye reads.
 */
export function rimCenteringOffsetPx(widthPx: number): number {
  return rimExposedHeightPx(widthPx) / 2;
}
