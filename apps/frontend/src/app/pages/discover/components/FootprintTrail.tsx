import { useEffect, useRef, useState } from 'react';

import { C } from '../discoverTheme';
import {
  nextFootprint,
  shouldEnableTrail,
  trimTrail,
  type Footprint,
} from '../footprintTrail';

/**
 * Footprints walking after the cursor across Discovery.
 *
 * ── Why it does not get in the way ─────────────────────────────────────────
 *
 * **It is painted behind the page, not over it.** The layer is `fixed` at
 * `z-0` and Explore's content sits above it, so a print can only ever appear
 * on the graph-paper ground in the page's side margins — never across a hostel
 * photo, a price, or a button. That is the whole trick: the effect is visible
 * while your eye is on the page as a whole and gone the moment you are reading
 * a card.
 *
 * Everything else is a way of saying no:
 * - `pointer-events: none`, so it can never eat a click;
 * - off entirely on touch, under `prefers-reduced-motion`, and below 1024px
 *   (see `shouldEnableTrail`);
 * - at most six prints, each fading out on its own in about two seconds;
 * - one `requestAnimationFrame` per move at most, and the listener is passive.
 *
 * The glyph is a bare foot rather than a shoe: the promise on the page above
 * it is "a hostel that feels like home", and you take your shoes off at home.
 */
export function FootprintTrail() {
  const [prints, setPrints] = useState<Footprint[]>([]);
  const [enabled, setEnabled] = useState(false);

  const last = useRef<{ x: number; y: number } | null>(null);
  const previous = useRef<Footprint | null>(null);
  const nextId = useRef(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointer = window.matchMedia('(pointer: fine)');

    const decide = () =>
      setEnabled(
        shouldEnableTrail({
          pointerFine: pointer.matches,
          reducedMotion: motion.matches,
          viewportWidth: window.innerWidth,
        }),
      );

    decide();
    // A person can turn reduced-motion on while the page is open, and a laptop
    // window can be resized below the threshold — both must take effect
    // without a reload.
    motion.addEventListener('change', decide);
    pointer.addEventListener('change', decide);
    window.addEventListener('resize', decide);
    return () => {
      motion.removeEventListener('change', decide);
      pointer.removeEventListener('change', decide);
      window.removeEventListener('resize', decide);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setPrints([]);
      return;
    }

    const onMove = (event: MouseEvent) => {
      // Coalesce to one frame: mousemove fires far more often than the screen
      // refreshes, and a decoration must not be the reason a scroll stutters.
      if (frame.current !== null) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        const point = { x: event.clientX, y: event.clientY };
        // Seed on the first move: there is no travel to measure yet.
        if (!last.current) {
          last.current = point;
          return;
        }

        const print = nextFootprint(last.current, point, previous.current, nextId.current);
        // `last` is the position of the **last footprint**, not of the last
        // frame. Resetting it every frame measured travel per-frame instead of
        // per-step, so anyone moving the mouse at a normal speed never covered
        // a full stride between frames and no print was ever left.
        if (!print) return;
        last.current = point;

        nextId.current += 1;
        previous.current = print;
        setPrints((current) => trimTrail([...current, print]));

        // Each print retires itself; the cap is a safety net, not the mechanism.
        window.setTimeout(() => {
          setPrints((current) => current.filter((item) => item.id !== print.id));
        }, 2000);
      });
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [enabled]);

  if (!enabled || prints.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      {prints.map((print) => (
        <span
          key={print.id}
          className="absolute"
          style={{
            left: print.x,
            top: print.y,
            transform: `translate(-50%,-50%) rotate(${print.angle}deg) scaleX(${print.side === 'left' ? -1 : 1})`,
            animation: 'stayoFootprint 2s ease-out forwards',
          }}
        >
          <Sole />
        </span>
      ))}

      {/* Scoped to this component rather than a global stylesheet: nothing else
          in the app has an opinion about how a footprint fades. */}
      <style>{`
        @keyframes stayoFootprint {
          0%   { opacity: 0;    transform-origin: center; }
          18%  { opacity: 0.26; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

/** A bare sole: ball of the foot, arch, and five toes. */
function Sole() {
  return (
    <svg width="19" height="26" viewBox="0 0 19 26" fill="none">
      <path
        d="M13.4 8.2c1.6 2.4 2.1 5 1.5 7.8-.5 2.4-.4 3.6.3 5.4.7 1.9-.4 3.8-2.4 4.2-2 .4-3.9-.7-4.3-2.5-.3-1.4-.8-2.3-1.9-3.4-1.8-1.8-2.6-3.9-2.4-6.4.2-3 1.6-5.4 4-6.6 2-1 3.9-.5 5.2 1.5Z"
        fill={C.clay}
      />
      <ellipse cx="6.1" cy="4.3" rx="2" ry="2.4" transform="rotate(-14 6.1 4.3)" fill={C.clay} />
      <ellipse cx="10.2" cy="2.6" rx="1.5" ry="1.9" fill={C.clay} />
      <ellipse cx="13.4" cy="3" rx="1.3" ry="1.6" transform="rotate(10 13.4 3)" fill={C.clay} />
      <ellipse cx="15.9" cy="4.6" rx="1.1" ry="1.3" transform="rotate(18 15.9 4.6)" fill={C.clay} />
    </svg>
  );
}
