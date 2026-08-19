/**
 * Which photo a scroll-snap gallery is currently showing.
 *
 * Split out of `ListingPage` because it is the one piece of the gallery with
 * a wrong answer available: a rounding or clamping slip shows "4 / 3" under
 * the photos, or leaves the dots one behind the swipe. Components in this app
 * are thin renderers over already-tested logic (no jsdom in the test suite),
 * so the arithmetic lives here.
 *
 * PURE — no DOM, no React.
 */
export function photoIndexFromScroll(scrollLeft: number, slideWidth: number, count: number): number {
  // A track that has not been laid out yet reports width 0; dividing by it
  // yields Infinity, which would clamp to the last photo on first paint.
  if (!Number.isFinite(scrollLeft) || !Number.isFinite(slideWidth) || slideWidth <= 0 || count <= 0) {
    return 0;
  }
  const index = Math.round(scrollLeft / slideWidth);
  // Overscroll (rubber-banding past either end) reports offsets outside the
  // track, and must not index past the photos that exist.
  return Math.min(Math.max(index, 0), count - 1);
}
