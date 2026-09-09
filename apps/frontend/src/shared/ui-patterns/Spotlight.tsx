import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { needsScroll, placeCaption, type Placement, type Rect } from './spotlightPlacement';

/**
 * A one-time orientation tour: the screen dims, one element stays lit, and a
 * caption points at it and explains it.
 *
 * Stops are anchored by **ref, not CSS selector**. A selector-based tour goes
 * silently wrong the moment someone renames a class — it dims the screen and
 * highlights nothing, which looks broken and is invisible to every check this
 * repo runs. A ref either resolves or the stop is skipped outright.
 *
 * Rendered through a portal so no ancestor's `overflow` or stacking context
 * can clip the overlay. `ThemeProvider` stamps `data-app-theme` on
 * `documentElement`, which a portal is still inside, so the Stayo tokens
 * resolve here exactly as they do in the tree.
 *
 * Written for the audience it actually has: a hostel owner who has run a
 * building for years and has never run software. That drives three choices
 * the earlier version got wrong.
 *
 * 1. **The caption points at the thing.** It follows the highlight and grows
 *    an arrow toward it, instead of floating in the middle of the screen with
 *    no visible relationship to what is lit. See `spotlightPlacement.ts`.
 * 2. **Tapping the lit element moves forward.** Previously it ended the tour —
 *    the one gesture everyone tries first was the one that threw the whole
 *    thing away, silently, with no way back to it.
 * 3. **Progress is written down.** "Step 2 of 3" and a Back button, not three
 *    dots. Dots tell you where you are only if you already know how to read
 *    them, and there was no way to re-read a stop you moved past too fast.
 */

export interface SpotlightStop {
  /** The element to light up. A stop whose ref is empty is skipped. */
  ref: RefObject<HTMLElement | null>;
  title: string;
  body: string;
}

interface SpotlightProps {
  open: boolean;
  stops: SpotlightStop[];
  onDone: () => void;
  /**
   * Named on the final button, for a tour that hands over to a specific next
   * action. Defaults to a plain acknowledgement.
   */
  finishLabel?: string;
}

/** Breathing room around the lit element, inside the cut-out. */
const PADDING = 10;

function rectOf(element: HTMLElement): Rect {
  const box = element.getBoundingClientRect();
  return {
    top: box.top - PADDING,
    left: box.left - PADDING,
    width: box.width + PADDING * 2,
    height: box.height + PADDING * 2,
  };
}

export function Spotlight({ open, stops, onDone, finishLabel = 'Got it' }: SpotlightProps) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const captionRef = useRef<HTMLDivElement | null>(null);

  /**
   * Anchor refs are populated by the caller's children, which mount *after*
   * this component's first render — and assigning a ref does not re-render.
   * Without waiting a frame, the first pass sees every ref empty, filters
   * every stop out, and the tour silently never appears.
   */
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!open) {
      setArmed(false);
      setIndex(0);
      return;
    }
    const frame = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Stops whose element never mounted are dropped rather than shown as an
  // empty highlight — a tour that points at nothing is worse than a shorter one.
  const live = stops.filter((stop) => stop.ref.current);
  const total = live.length;
  const stop = live[Math.min(index, Math.max(total - 1, 0))];
  const isLast = index >= total - 1;

  const finish = useCallback(() => {
    setIndex(0);
    onDone();
  }, [onDone]);

  const next = useCallback(() => {
    if (isLast) {
      finish();
      return;
    }
    setIndex((i) => i + 1);
  }, [isLast, finish]);

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Measured in a layout effect so the cut-out is painted in the same frame as
  // the scrim; measuring in a passive effect shows a full-screen dim first.
  useLayoutEffect(() => {
    if (!open || !armed || !stop?.ref.current) {
      setRect(null);
      return;
    }
    const element = stop.ref.current;
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    // Only scroll when the anchor is genuinely out of view. Scrolling on every
    // stop jerked the page under the scrim even when nothing had to move.
    if (needsScroll({ element: rectOf(element), viewport })) {
      element.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
    setRect(rectOf(element));

    const remeasure = () => setRect(rectOf(element));
    window.addEventListener('resize', remeasure);
    window.addEventListener('scroll', remeasure, true);
    return () => {
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('scroll', remeasure, true);
    };
  }, [open, armed, stop, index]);

  // Placement needs the caption's real height, which is only known once it has
  // rendered with this stop's copy in it — so it is a second pass, keyed on
  // the measured rect.
  useLayoutEffect(() => {
    if (!rect || !captionRef.current) {
      setPlacement(null);
      return;
    }
    const box = captionRef.current.getBoundingClientRect();
    setPlacement(
      placeCaption({
        highlight: rect,
        caption: { width: box.width, height: box.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }),
    );
  }, [rect, index]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
      if (event.key === 'ArrowLeft') back();
      if (event.key === 'ArrowRight' || event.key === 'Enter') next();
    };
    document.addEventListener('keydown', onKey);
    // The page behind is inert while the tour runs, so a stray tap or scroll
    // can't act on something the owner cannot currently see.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, finish, next, back]);

  if (!open || !armed || !stop || !rect || typeof document === 'undefined') return null;

  const titleId = 'stayo-spotlight-title';
  const bodyId = 'stayo-spotlight-body';

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="fixed inset-0 z-[100]"
    >
      {/* One box-shadow dims everything outside the cut-out — cheaper and
          crisper than four separate scrim panels, and it animates as one.
          The ring is what actually says "this one": a scrim alone reads as
          the screen having gone dark, not as an element being singled out. */}
      <div
        aria-hidden
        onClick={next}
        className="absolute rounded-[18px] ring-2 ring-primary/70 transition-all duration-300 motion-reduce:transition-none"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          boxShadow: '0 0 0 9999px rgba(34, 30, 26, 0.68), 0 0 0 6px rgba(180, 106, 85, 0.22)',
          pointerEvents: 'auto',
        }}
      />

      <div
        ref={captionRef}
        className="absolute w-[min(92vw,360px)] rounded-[20px] border border-border bg-card p-4 shadow-[0_20px_48px_rgba(34,30,26,0.32)] transition-[top,left] duration-300 motion-reduce:transition-none"
        style={
          placement
            ? { top: placement.top, left: placement.left }
            : // First paint, before the caption has been measured: park it off
              // screen rather than flashing it in the wrong place.
              { top: -9999, left: 0 }
        }
      >
        {/* The arrow. A rotated square rather than a border triangle so it
            inherits the card's own background and border in both tone sets. */}
        {placement && (
          <span
            aria-hidden
            className="absolute h-3 w-3 rotate-45 border-border bg-card"
            style={{
              left: placement.arrowLeft - 6,
              ...(placement.side === 'below'
                ? { top: -7, borderTopWidth: 1, borderLeftWidth: 1 }
                : { bottom: -7, borderBottomWidth: 1, borderRightWidth: 1 }),
            }}
          />
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-display text-[11px] font-extrabold uppercase tracking-[0.06em] text-primary">
            Step {index + 1} of {total}
          </span>
          <button
            type="button"
            onClick={finish}
            className="min-h-[32px] rounded-lg px-1.5 text-[12.5px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Skip tour
          </button>
        </div>

        <p id={titleId} className="mt-2.5 font-display text-[16px] font-extrabold leading-snug tracking-[-0.01em] text-foreground">
          {stop.title}
        </p>
        <p id={bodyId} className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {stop.body}
        </p>

        <div className="mt-4 flex items-center gap-2">
          {index > 0 && (
            <button
              type="button"
              onClick={back}
              aria-label="Previous step"
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-border px-3 font-display text-[13px] font-bold text-foreground active:scale-[0.98] transition-transform"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.4} />
              Back
            </button>
          )}
          <button
            type="button"
            autoFocus
            onClick={next}
            className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 font-display text-[13.5px] font-bold text-primary-foreground shadow-sm active:scale-[0.98] transition-transform"
          >
            {isLast ? finishLabel : 'Next'}
            {!isLast && <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
