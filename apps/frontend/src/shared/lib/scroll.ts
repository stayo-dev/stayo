/**
 * Scroll reading that works regardless of which element actually scrolls.
 *
 * Why this exists: `theme.css` sets `overflow-x: hidden` on both `html` and
 * `body`. Per CSS spec, a non-`visible` value on one axis forces the other
 * axis from `visible` to `auto` — which quietly makes `<body>` the scroll
 * container instead of the document. Measured in a headless browser against
 * the live landing page:
 *
 *   document.documentElement.scrollHeight = 437   (exactly the viewport)
 *   document.body.scrollHeight            = 5101  (the real content)
 *
 * So `window.scrollY` is permanently `0`, and — verified the same way — a
 * `scroll` listener on `window` fires 0 times and one on `document` fires 0
 * times; only the listener on `body` fires. Any code reading `window.scrollY`
 * or binding to `window` alone is silently dead on this app.
 *
 * These helpers are deliberately thin DOM reads: `apps/frontend` tests run in
 * a node environment with no jsdom, so the arithmetic that consumes them
 * lives in pure, tested functions instead (see `computeScrollFraction`).
 */

/** Scroll offset of whichever element actually scrolls. */
export function readScrollTop(): number {
  if (typeof window === 'undefined') return 0;
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
}

export type ScrollGeometry = {
  scrollTop: number;
  contentHeight: number;
  viewportHeight: number;
};

/** Everything needed to work out how far down the page the visitor is. */
export function readScrollGeometry(): ScrollGeometry {
  if (typeof window === 'undefined') {
    return { scrollTop: 0, contentHeight: 0, viewportHeight: 0 };
  }
  return {
    scrollTop: readScrollTop(),
    contentHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    viewportHeight: window.innerHeight,
  };
}

/**
 * Subscribe to scroll on every plausible target and return an unsubscribe.
 *
 * Binds `window`, `document` and `body` because which one emits depends on
 * the overflow situation described above; the handler must be idempotent.
 * Fires once immediately so callers settle correctly on a back-navigation
 * that restores scroll position, where no scroll event ever arrives.
 */
export function subscribeToScroll(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const targets: EventTarget[] = [window, document, document.body];
  targets.forEach((target) => target.addEventListener('scroll', handler, { passive: true }));
  handler();

  return () => targets.forEach((target) => target.removeEventListener('scroll', handler));
}
