/**
 * Instantly jumps the page to the top, regardless of the global
 * `scroll-behavior: smooth` set on `html` (theme.css).
 *
 * `window.scrollTo({ behavior: 'auto' })` is *supposed* to override CSS
 * `scroll-behavior`, but that isn't reliable across browsers — it can still
 * animate and get interrupted mid-scroll by the page's content changing
 * underneath it (exactly what a route change does). Setting `scrollTop`
 * directly is not a scroll *API* the CSS property applies to, so it's
 * always instant. Sets it on both `documentElement` and `body` since
 * different browsers (notably older Safari/WebKit) disagree on which
 * element owns the page's scroll position.
 */
export function scrollToTopInstant() {
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

const SCROLL_DURATION_MS = 450;

// ease-out cubic — fast start, gentle landing, matches the Notion-style feel
// asked for rather than a linear scroll.
function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function currentScrollY() {
  return document.documentElement.scrollTop || document.body.scrollTop || window.scrollY || 0;
}

/**
 * Animates to the top over a fixed, short duration — driven by our own
 * requestAnimationFrame loop rather than `scrollTo({behavior:'smooth'})` or
 * CSS `scroll-behavior`. Both of those failed in practice here: a native
 * smooth scroll can visibly stall partway when it races against the page's
 * content still settling after a route change (the scrollable height it
 * started animating against isn't the final one). This loop always forces
 * the exact scroll position on every frame and finishes by setting it to 0
 * outright, so it lands at the true top no matter what the content is
 * doing underneath it.
 *
 * Respects prefers-reduced-motion — jumps instantly instead of animating
 * for anyone with that OS preference set.
 */
export function scrollToTopSmooth() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    scrollToTopInstant();
    return;
  }

  const start = currentScrollY();
  if (start <= 0) return;

  const startTime = performance.now();

  const step = (now: number) => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / SCROLL_DURATION_MS, 1);
    const next = Math.round(start * (1 - easeOutCubic(progress)));

    document.documentElement.scrollTop = next;
    document.body.scrollTop = next;

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      scrollToTopInstant();
    }
  };

  requestAnimationFrame(step);
}
