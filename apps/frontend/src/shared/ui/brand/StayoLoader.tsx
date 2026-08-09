/*
 * StayoLoader — the inline "we are waiting" mark.
 *
 * The Stayo mark's four windows, lighting clockwise. This is the *only*
 * sanctioned busy indicator for buttons, rows, cards and section bodies;
 * rotating rings (`animate-spin`, `<Loader2 />`) are deliberately gone from
 * the app so that every wait, from a 200ms button press to a cold app boot,
 * reads as the same brand gesture. For a whole-screen wait use
 * `StayoLoadingScreen` instead.
 *
 * Colour comes from `currentColor`, so it drops into a primary button, a
 * muted caption or a destructive action without configuration.
 */
import { cn } from '@shared/lib/cn';

import './stayo-loading.css';

export type StayoLoaderSize = 'xs' | 'sm' | 'md' | 'lg';

/** [box, dot, gap] in px. The mark reads as a 2×2 window grid at every size. */
const SIZES: Record<StayoLoaderSize, readonly [number, number, number]> = {
  xs: [12, 5, 2], // inside a button, beside a label
  sm: [16, 7, 2], // inline with body text
  md: [24, 10, 4], // a card or list body
  lg: [36, 15, 6], // a panel or modal body
};

export interface StayoLoaderProps {
  size?: StayoLoaderSize;
  className?: string;
  /**
   * Announced to screen readers. Pass `null` when a visible label already says
   * what is happening (e.g. a button reading "Saving…"), so it isn't read twice.
   */
  label?: string | null;
}

export function StayoLoader({ size = 'sm', className, label = 'Loading' }: StayoLoaderProps) {
  const [box, dot, gap] = SIZES[size];
  return (
    <span
      className={cn('stayo-load stayo-load__dots', className)}
      style={{ width: box, height: box, gap }}
      role={label ? 'status' : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      <span className="stayo-load__dot" style={{ width: dot, height: dot }} />
      <span className="stayo-load__dot" style={{ width: dot, height: dot }} />
      <span className="stayo-load__dot" style={{ width: dot, height: dot }} />
      <span className="stayo-load__dot" style={{ width: dot, height: dot }} />
    </span>
  );
}

export interface StayoLoadingBlockProps {
  /** Optional caption under the mark, e.g. "Loading payments…". */
  message?: string;
  size?: StayoLoaderSize;
  className?: string;
}

/**
 * A centred loader for a section body that is waiting on its own data — the
 * drop-in replacement for the old `<div className="flex justify-center py-8">
 * <Loader2 className="animate-spin" /></div>` pattern.
 */
export function StayoLoadingBlock({ message, size = 'md', className }: StayoLoadingBlockProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-8 text-primary', className)}>
      <StayoLoader size={size} label={message ? null : 'Loading'} />
      {message ? (
        <p className="text-sm font-medium text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
