import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  AGREEMENT_MONTH_OPTIONS,
  AGREEMENT_PRESETS,
  MAX_AGREEMENT_MONTHS,
  MIN_AGREEMENT_MONTHS,
  indexForMonths,
  indexFromScroll,
  monthsAtIndex,
  scrollLeftForIndex,
} from '../agreementTerm';

/** Width of one month in the strip, in px. Shared with the padding maths below. */
const ITEM_WIDTH = 44;
/** How long the strip must sit still before its resting position is read as a choice. */
const SETTLE_MS = 90;

interface DurationRingProps {
  /** Months, as the wizard stores it — a string, empty until a value is chosen. */
  value: string;
  onChange: (months: number) => void;
}

/**
 * The agreement-length picker: a strip of months you flick past a fixed centre
 * marker, the way a dial turns.
 *
 * It replaces a free-text numeric input, which asked for a number and accepted
 * anything — `0`, `999`, a stray keystroke — while the consequence an owner
 * actually cares about (when the agreement ends) went unstated.
 *
 * Horizontal rather than the vertical drum a dial suggests, for one concrete
 * reason: this lives inside a `BottomSheet` that scrolls vertically, so a
 * vertical drum would make every downward drag ambiguous — sheet or dial? A
 * horizontal axis is unclaimed, so a flick here can only mean one thing.
 *
 * Three ways in, because owners arrive on different devices: flick or drag the
 * strip, tap a preset chip, or hold an arrow key. The scroll maths is pure and
 * tested in `agreementTerm.ts`; this component only turns scroll position into
 * an index and back.
 */
export function DurationRing({ value, onChange }: DurationRingProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Suppresses the scroll handler while *we* are the ones scrolling. Without
   * it, programmatically centring a preset fires `onScroll` on the way there
   * and reports every month it passes over as a choice.
   */
  const scrollingSelf = useRef(false);

  /**
   * The form stores months as a string and it is legitimately empty until the
   * hostel's own defaults land (or the owner picks). The ring still has to rest
   * somewhere, so it rests on the shortest term — but it must not *look*
   * chosen while it isn't, or an owner reads a highlighted "1" as their answer.
   */
  const isUnset = !(Number(value) > 0);
  const selectedIndex = indexForMonths(value);
  const months = monthsAtIndex(selectedIndex);

  // Keeps the strip's resting position in step with the value whenever it is
  // changed from anywhere but a drag — a preset chip, an arrow key, or the
  // hostel's own defaults arriving after a room is picked.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const target = scrollLeftForIndex(selectedIndex, ITEM_WIDTH);
    if (Math.abs(track.scrollLeft - target) < 1) return;
    scrollingSelf.current = true;
    track.scrollTo({ left: target, behavior: 'smooth' });
    const done = setTimeout(() => {
      scrollingSelf.current = false;
    }, 300);
    return () => clearTimeout(done);
  }, [selectedIndex]);

  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  const handleScroll = () => {
    if (scrollingSelf.current) return;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const track = trackRef.current;
      if (!track) return;
      const next = monthsAtIndex(indexFromScroll(track.scrollLeft, ITEM_WIDTH));
      if (next !== months) onChange(next);
    }, SETTLE_MS);
  };

  const step = (delta: number) => onChange(monthsAtIndex(selectedIndex + delta));

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 6, PageDown: -6,
    };
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      onChange(event.key === 'Home' ? MIN_AGREEMENT_MONTHS : MAX_AGREEMENT_MONTHS);
      return;
    }
    const delta = moves[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    step(delta);
  };

  return (
    <div>
      <div className="relative">
        {/*
          The centre marker. Drawn behind the numbers and pinned to the middle
          of the track, so "which month am I on" is answered by position rather
          than by hunting for the one that looks different.
        */}
        <div
          aria-hidden
          className={`pointer-events-none absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-xl ${
            isUnset ? 'border border-dashed border-border' : 'border-[1.5px] border-primary bg-primary/10'
          }`}
        />
        <div
          ref={trackRef}
          onScroll={handleScroll}
          onKeyDown={onKeyDown}
          role="slider"
          tabIndex={0}
          aria-label="Agreement duration in months"
          aria-valuemin={MIN_AGREEMENT_MONTHS}
          aria-valuemax={MAX_AGREEMENT_MONTHS}
          aria-valuenow={isUnset ? undefined : months}
          aria-valuetext={isUnset ? 'Not set' : `${months} ${months === 1 ? 'month' : 'months'}`}
          className="flex snap-x snap-mandatory overflow-x-auto py-2 [scrollbar-width:none] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 [&::-webkit-scrollbar]:hidden"
          // Half the track minus half an item, so the first and last months can
          // still reach the centre marker — which is also what makes
          // `indexFromScroll` a plain division.
          style={{ paddingInline: `calc(50% - ${ITEM_WIDTH / 2}px)` }}
        >
          {AGREEMENT_MONTH_OPTIONS.map((option, index) => {
            const distance = Math.abs(index - selectedIndex);
            const active = distance === 0;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onChange(option)}
                tabIndex={-1}
                aria-hidden
                style={{ width: ITEM_WIDTH }}
                className={`flex h-11 flex-none snap-center items-center justify-center rounded-xl font-display tabular-nums transition-colors ${
                  active
                    ? isUnset
                      ? 'text-lg font-extrabold text-muted-foreground'
                      : 'text-lg font-extrabold text-primary'
                    : distance === 1
                      ? 'text-sm font-bold text-foreground/70'
                      : 'text-[13px] font-semibold text-muted-foreground/60'
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {AGREEMENT_PRESETS.map((preset) => {
          const active = !isUnset && preset === months;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(preset)}
              aria-pressed={active}
              className={`rounded-full px-3 py-1 text-[11.5px] font-semibold tabular-nums ${
                active ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-foreground/75'
              }`}
            >
              {preset} mo
            </button>
          );
        })}
      </div>
    </div>
  );
}
