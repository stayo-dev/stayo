/**
 * The graph-paper ground, as class strings so every section rules the same way.
 *
 * It was only on the hero, which made the page look like one textured band
 * followed by flat colour. It is the page's ground, not a hero decoration.
 */

/** Warm Clay ruling for the cream sections. */
export const GROUND_LIGHT =
  '[background-image:linear-gradient(rgba(180,106,85,.10)_1px,transparent_1px),linear-gradient(90deg,rgba(180,106,85,.10)_1px,transparent_1px)] [background-size:52px_52px]';

/** The same ruling inverted, for charcoal panels. */
export const GROUND_DARK =
  '[background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)] [background-size:48px_48px]';

/**
 * Clears the sticky header when an in-page anchor is followed — without it
 * `#how` scrolls the heading underneath the header and the section looks
 * decapitated.
 */
export const ANCHOR_OFFSET = 'scroll-mt-[84px] sm:scroll-mt-[96px]';
