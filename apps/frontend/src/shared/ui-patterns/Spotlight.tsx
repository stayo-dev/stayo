import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/**
 * A one-time orientation tour: the screen dims, one element stays lit, and a
 * caption explains it.
 *
 * Stops are anchored by **ref, not CSS selector**. A selector-based tour goes
 * silently wrong the moment someone renames a class — it dims the screen and
 * highlights nothing, which looks broken and is invisible to every check this
 * repo runs. A ref either resolves or the stop is skipped outright.
 *
 * Rendered through a portal so no ancestor's `overflow` or stacking context
 * can clip the overlay. `ThemeProvider` sets `data-app-theme` on
 * `documentElement`, which a portal is still inside, so the StayO tokens
 * resolve here exactly as they do in the tree.
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
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 8;

function rectOf(element: HTMLElement): Rect {
  const box = element.getBoundingClientRect();
  return {
    top: box.top - PADDING,
    left: box.left - PADDING,
    width: box.width + PADDING * 2,
    height: box.height + PADDING * 2,
  };
}

export function Spotlight({ open, stops, onDone }: SpotlightProps) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
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
      return;
    }
    const frame = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Stops whose element never mounted are dropped rather than shown as an
  // empty highlight — a tour that points at nothing is worse than a shorter one.
  const live = stops.filter((stop) => stop.ref.current);
  const stop = live[index];

  const finish = useCallback(() => {
    setIndex(0);
    onDone();
  }, [onDone]);

  // Measured in a layout effect so the cut-out is painted in the same frame as
  // the scrim; measuring in a passive effect shows a full-screen dim first.
  useLayoutEffect(() => {
    if (!open || !armed || !stop?.ref.current) {
      setRect(null);
      return;
    }
    const element = stop.ref.current;
    element.scrollIntoView({ block: 'center', behavior: 'auto' });
    setRect(rectOf(element));

    const remeasure = () => setRect(rectOf(element));
    window.addEventListener('resize', remeasure);
    window.addEventListener('scroll', remeasure, true);
    return () => {
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('scroll', remeasure, true);
    };
  }, [open, armed, stop, index]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        setIndex((i) => (i + 1 < live.length ? i + 1 : (finish(), i)));
      }
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
  }, [open, live.length, finish]);

  if (!open || !armed || !stop || !rect || typeof document === 'undefined') return null;

  const isLast = index === live.length - 1;
  const captionTop = rect.top + rect.height + 12;
  const showAbove = captionTop > window.innerHeight - 180;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Getting started tour"
      className="fixed inset-0 z-[100]"
    >
      {/* One box-shadow dims everything outside the cut-out — cheaper and
          crisper than four separate scrim panels, and it animates as one. */}
      <div
        aria-hidden
        onClick={finish}
        className="absolute rounded-2xl transition-all duration-300 motion-reduce:transition-none"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          boxShadow: '0 0 0 9999px rgba(28, 20, 14, 0.62)',
          pointerEvents: 'auto',
        }}
      />

      <div
        className="absolute left-1/2 w-[min(92vw,380px)] -translate-x-1/2 rounded-2xl border border-border bg-card p-4 shadow-[0_18px_44px_rgba(40,30,20,0.28)]"
        style={showAbove ? { top: Math.max(16, rect.top - 168) } : { top: captionTop }}
      >
        <p aria-live="polite" className="font-display text-[15px] font-extrabold leading-snug text-foreground">
          {stop.title}
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{stop.body}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5" aria-hidden>
            {live.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? 'w-4 bg-primary' : 'w-1.5 bg-border'
                }`}
              />
            ))}
          </span>

          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={finish}
              className="min-h-[40px] rounded-xl px-3 font-display text-[13px] font-bold text-muted-foreground hover:text-foreground"
            >
              Skip
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => (isLast ? finish() : setIndex(index + 1))}
              className="min-h-[40px] rounded-xl bg-primary px-4 font-display text-[13px] font-bold text-primary-foreground active:scale-[0.98] transition-transform"
            >
              {isLast ? 'Got it' : 'Next'}
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
