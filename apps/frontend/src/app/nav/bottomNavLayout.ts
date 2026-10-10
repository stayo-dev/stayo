/**
 * How the bottom nav lays out its tabs on a phone (below `lg`).
 *
 * At most five tabs are visible at once; each takes exactly a fifth of the bar.
 * A sixth (the live-tenant nav's Explore) sits just off the right edge and is
 * reached by swiping the bar. Two to five tabs share the width as before.
 *
 * Hiding a tab off-screen was rejected once because nothing showed the bar
 * continued, so scrolling comes with a right-edge fade while more is hidden,
 * snap points so it always rests on whole tabs, and the active tab scrolled
 * into view — opening Explore never leaves its own tab out of sight.
 *
 * PURE — no React, no DOM; runs under the node-only suite.
 */
export const MAX_VISIBLE_BOTTOM_TABS = 5;

export function bottomNavScrolls(tabCount: number): boolean {
  return tabCount > MAX_VISIBLE_BOTTOM_TABS;
}

/** Sub-pixel rounding leaves a few px of "scroll" at the very end. */
const END_TOLERANCE_PX = 4;

/** Whether tabs remain hidden past the right edge — drives the fade hint. */
export function hasHiddenTabsToTheRight(box: { scrollLeft: number; clientWidth: number; scrollWidth: number }): boolean {
  return box.scrollWidth - box.clientWidth - box.scrollLeft > END_TOLERANCE_PX;
}

/**
 * The `scrollLeft` that brings the active tab fully into view, or null when it
 * already is. Scrolls the minimum needed, so tapping a visible tab never moves
 * the bar.
 */
export function scrollLeftToReveal(
  item: { offsetLeft: number; offsetWidth: number },
  box: { scrollLeft: number; clientWidth: number },
): number | null {
  const itemEnd = item.offsetLeft + item.offsetWidth;
  if (item.offsetLeft < box.scrollLeft) return item.offsetLeft;
  if (itemEnd > box.scrollLeft + box.clientWidth) return itemEnd - box.clientWidth;
  return null;
}
