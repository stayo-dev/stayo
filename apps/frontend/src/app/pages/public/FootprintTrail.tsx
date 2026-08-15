import { useEffect, useRef } from 'react';

/**
 * Footprints that follow the cursor across the welcome screen, as though the
 * visitor were walking the floor of the place they're looking for.
 *
 * Written imperatively rather than as React state on purpose: a pointermove
 * handler that called setState would re-render the whole screen dozens of
 * times a second, and this is decoration — it must cost the front door
 * nothing. Nodes are created, animated by CSS, and removed on `animationend`.
 *
 * Two details do the work:
 *   - prints alternate left/right and sit offset *perpendicular* to the
 *     direction of travel, so a diagonal walk leaves a diagonal gait rather
 *     than two parallel rails;
 *   - each print is coloured by which side of the seam it lands on — dark on
 *     the cream tenant half, light on the near-black owner half — using the
 *     same seam geometry the panels clip to.
 *
 * **On touch, there is no cursor to trail, so the effect comes from two
 * sources instead of one.** Dragging a finger leaves prints exactly as a
 * cursor does — `pointermove` covers touch already. But a visitor who only
 * taps would never see the screen move at all, so coarse-pointer devices also
 * get an *ambient* walk: a stroll across the screen every few seconds, laid
 * down one print at a time so it reads as walking rather than appearing. That
 * is the whole difference between the two platforms; the print geometry,
 * colouring and cleanup are shared.
 */

/** Pixels of travel between prints. Roughly a stride at this scale. */
const STRIDE = 58;

/** How far each foot sits from the centre line of travel. */
const FOOT_OFFSET = 9;

/** Must match SEAM_SPREAD in WelcomePage — the seam's half-spread in % of height. */
const SEAM_SPREAD = 3.2;

/** Matches the CSS animation duration; nodes are also removed on animationend. */
const PRINT_MS = 1500;

/** Ambient walk (touch only) — pace, length, and the rest between strolls. */
const AMBIENT_STEP_MS = 340;
const AMBIENT_MIN_STEPS = 6;
const AMBIENT_MAX_STEPS = 10;
const AMBIENT_REST_MIN_MS = 2200;
const AMBIENT_REST_MAX_MS = 4200;
/** A beat after the screen settles, so the first stroll isn't part of the splash. */
const AMBIENT_FIRST_DELAY_MS = 1200;

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

interface FootprintTrailProps {
  /** Where the seam's midpoint sits, in % of viewport height. */
  pct: number;
  /** False during the splash, so prints don't appear before the screen does. */
  enabled: boolean;
}

export function FootprintTrail({ pct, enabled }: FootprintTrailProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  // Read through a ref so the pointermove listener never needs re-subscribing
  // when the seam moves.
  const pctRef = useRef(pct);
  pctRef.current = pct;

  useEffect(() => {
    if (!enabled) return;

    const layer = layerRef.current;
    if (!layer) return;

    // Motion is the whole effect — there is nothing to degrade to.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Touch has no hover to trail from, so a dragged finger is only half the
    // answer; the ambient stroll below is the other half.
    const coarse = !window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    let leftFoot = true;

    /** Lay one print at (x, y) travelling along `angle`. The shared core. */
    const emit = (x: number, y: number, angle: number) => {
      // Heading's unit normal — what separates the two feet.
      const nx = -Math.sin(angle);
      const ny = Math.cos(angle);
      const side = leftFoot ? 1 : -1;
      leftFoot = !leftFoot;

      const px = x + nx * FOOT_OFFSET * side;
      const py = y + ny * FOOT_OFFSET * side;

      // Which half did this land on? Same geometry the panels clip to: the
      // seam runs from (pct - spread) at the left edge to (pct + spread) at
      // the right.
      const seamPct = pct_at(pctRef.current, px / window.innerWidth);
      const seamY = (seamPct / 100) * window.innerHeight;
      const onDarkHalf = py > seamY;

      const print = document.createElement('span');
      print.className = 'stayo-welcome-print';
      print.style.left = `${px}px`;
      print.style.top = `${py}px`;
      // +90° because the glyph is drawn pointing up, not right.
      print.style.setProperty('--print-rotate', `${(angle * 180) / Math.PI + 90}deg`);
      print.style.setProperty('--print-color', onDarkHalf ? 'rgba(231,169,134,.42)' : 'rgba(140,103,84,.30)');
      print.innerHTML = FOOT_SVG;

      print.addEventListener('animationend', () => print.remove(), { once: true });
      layer.appendChild(print);
    };

    // ── Pointer trail: cursor on desktop, dragged finger on touch ──────────
    let lastX: number | null = null;
    let lastY: number | null = null;
    let travelled = 0;

    const onMove = (event: PointerEvent) => {
      const { clientX: x, clientY: y } = event;

      if (lastX === null || lastY === null) {
        lastX = x;
        lastY = y;
        return;
      }

      const dx = x - lastX;
      const dy = y - lastY;
      travelled += Math.hypot(dx, dy);
      lastX = x;
      lastY = y;

      if (travelled < STRIDE) return;
      travelled = 0;

      emit(x, y, Math.atan2(dy, dx));
    };

    // A finger lifted and put down elsewhere is a new walk, not a giant stride
    // across the screen — without this the next print sits on a heading drawn
    // between two unrelated touches.
    const onPointerDown = (event: PointerEvent) => {
      lastX = event.clientX;
      lastY = event.clientY;
      travelled = 0;
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });

    // ── Ambient stroll: touch only ─────────────────────────────────────────
    // Someone who only ever taps would otherwise see a completely still
    // screen, which is the bug this exists to fix.
    let stepTimer: ReturnType<typeof setTimeout> | undefined;
    let restTimer: ReturnType<typeof setTimeout> | undefined;

    const stroll = () => {
      const { innerWidth: w, innerHeight: h } = window;

      // Walk broadly left-to-right or right-to-left, with a gentle drift, and
      // start off the edge so the walker appears to enter rather than pop in.
      const leftToRight = Math.random() < 0.5;
      const heading = (leftToRight ? 0 : Math.PI) + randomBetween(-0.42, 0.42);
      const steps = Math.round(randomBetween(AMBIENT_MIN_STEPS, AMBIENT_MAX_STEPS));

      let x = leftToRight ? -STRIDE : w + STRIDE;
      // Keep clear of the CTAs at the vertical extremes; the middle band is
      // where the seam lives and where a walk reads best.
      let y = randomBetween(h * 0.18, h * 0.82);

      let placed = 0;
      const walk = () => {
        if (placed >= steps) {
          restTimer = setTimeout(stroll, randomBetween(AMBIENT_REST_MIN_MS, AMBIENT_REST_MAX_MS));
          return;
        }
        x += Math.cos(heading) * STRIDE;
        y += Math.sin(heading) * STRIDE;
        placed += 1;

        // Stop early rather than laying prints into the void off-screen.
        if (x < -STRIDE || x > w + STRIDE || y < 0 || y > h) {
          restTimer = setTimeout(stroll, randomBetween(AMBIENT_REST_MIN_MS, AMBIENT_REST_MAX_MS));
          return;
        }

        emit(x, y, heading);
        stepTimer = setTimeout(walk, AMBIENT_STEP_MS);
      };

      walk();
    };

    if (coarse) restTimer = setTimeout(stroll, AMBIENT_FIRST_DELAY_MS);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onPointerDown);
      clearTimeout(stepTimer);
      clearTimeout(restTimer);
      // A trail mid-fade would otherwise outlive the screen it belongs to.
      layer.replaceChildren();
    };
  }, [enabled]);

  return (
    <div
      ref={layerRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[5] overflow-hidden"
    />
  );
}

/** Seam height, in % of viewport, at a horizontal position `f` (0 → 1). */
function pct_at(pct: number, f: number): number {
  return pct - SEAM_SPREAD + SEAM_SPREAD * 2 * Math.min(Math.max(f, 0), 1);
}

/**
 * A stylised bare foot: sole, plus a big toe and three smaller ones. Drawn
 * pointing up so the rotation above can treat 0° as "north".
 */
const FOOT_SVG = `
<svg width="16" height="22" viewBox="0 0 16 22" fill="currentColor" aria-hidden="true">
  <ellipse cx="8" cy="14.5" rx="4.6" ry="6.4"/>
  <ellipse cx="5.4" cy="4.6" rx="2.5" ry="2.9"/>
  <circle cx="9.9" cy="3.5" r="1.5"/>
  <circle cx="12.3" cy="5.6" r="1.25"/>
  <circle cx="13.6" cy="8.3" r="1.05"/>
</svg>`;

export { PRINT_MS };
