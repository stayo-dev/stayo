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
 */

/** Pixels of travel between prints. Roughly a stride at this scale. */
const STRIDE = 58;

/** How far each foot sits from the centre line of travel. */
const FOOT_OFFSET = 9;

/** Must match SEAM_SPREAD in WelcomePage — the seam's half-spread in % of height. */
const SEAM_SPREAD = 3.2;

/** Matches the CSS animation duration; nodes are also removed on animationend. */
const PRINT_MS = 1500;

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

    // Touch taps would leave a lone print with no walk behind it, and a coarse
    // pointer has no hover to trail from. Desktop only, by construction.
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (!fine.matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let lastX: number | null = null;
    let lastY: number | null = null;
    let travelled = 0;
    let leftFoot = true;

    const onMove = (event: PointerEvent) => {
      const { clientX: x, clientY: y } = event;

      if (lastX === null || lastY === null) {
        lastX = x;
        lastY = y;
        return;
      }

      const dx = x - lastX;
      const dy = y - lastY;
      const step = Math.hypot(dx, dy);
      lastX = x;
      lastY = y;

      travelled += step;
      if (travelled < STRIDE) return;
      travelled = 0;

      // Heading, and the unit normal to it — the normal is what separates the
      // two feet.
      const angle = Math.atan2(dy, dx);
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

    window.addEventListener('pointermove', onMove, { passive: true });

    return () => {
      window.removeEventListener('pointermove', onMove);
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
