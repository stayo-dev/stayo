/*
 * StayoLoadingScreen — the full-bleed Stayo loading screen.
 *
 * Warm sky gradient, drifting embers, the mark's four windows lighting
 * clockwise, and a linear progress track. No rotating rings anywhere — see
 * stayo-loading.css for why the palette is hard-coded rather than themed.
 *
 * Use this for whole-surface waits: route `Suspense` fallbacks, auth/session
 * gates, payment-return polling, modal bodies that own the entire dialog. For a
 * button or a card body use `StayoLoader` / `StayoLoadingBlock` instead.
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '@shared/lib/cn';

import { StayoMark } from './StayoMark';
import { StayoWordmark } from './StayoWordmark';
import './stayo-loading.css';

/**
 * Brand voice for the wait. Rotated only when the caller has nothing specific
 * to say — a caller that knows what it is doing ("Confirming your payment…")
 * should pass `message` and keep the line still.
 */
export const STAYO_LOADING_LINES = [
  'Getting your rooms ready',
  'Turning on the lights',
  "Counting who's home",
  "Lining up today's arrivals",
  'Warming up your welcome',
  'Tidying the rooms',
  'Sorting the keys',
  'Opening the windows',
] as const;

/**
 * Fixed, hand-tuned ember field. Deliberately not random: a stable field means
 * the pre-React boot splash in index.html and this component can show the same
 * screen, so React mounting is invisible rather than a restart.
 */
const PARTICLES = [
  { left: 6, size: 4, duration: 9.5, delay: -1.2, opacity: 0.62 },
  { left: 14, size: 6, duration: 7.4, delay: -6.1, opacity: 0.8 },
  { left: 21, size: 3, duration: 11.2, delay: -3.4, opacity: 0.55 },
  { left: 29, size: 5, duration: 8.1, delay: -8.7, opacity: 0.74 },
  { left: 36, size: 7, duration: 10.4, delay: -0.5, opacity: 0.6 },
  { left: 43, size: 4, duration: 6.6, delay: -4.9, opacity: 0.85 },
  { left: 50, size: 5, duration: 9.1, delay: -7.8, opacity: 0.68 },
  { left: 57, size: 3, duration: 11.8, delay: -2.3, opacity: 0.58 },
  { left: 64, size: 6, duration: 7.9, delay: -9.4, opacity: 0.78 },
  { left: 71, size: 4, duration: 10.1, delay: -5.6, opacity: 0.66 },
  { left: 78, size: 7, duration: 6.9, delay: -1.9, opacity: 0.72 },
  { left: 85, size: 3, duration: 9.8, delay: -8.2, opacity: 0.56 },
  { left: 91, size: 5, duration: 8.4, delay: -3.1, opacity: 0.82 },
  { left: 96, size: 4, duration: 11.5, delay: -6.7, opacity: 0.64 },
] as const;

const ROTATE_MS = 1750;
const FADE_MS = 260;

export interface StayoLoadingScreenProps {
  /**
   * `screen` fills the viewport (route fallbacks, auth gates). `inset` fills its
   * parent box (a modal or sheet body). `overlay` absolutely covers a positioned
   * parent, for refreshing content that is already on screen.
   */
  variant?: 'screen' | 'inset' | 'overlay';
  /** A specific line to show. Omit to rotate `STAYO_LOADING_LINES`. */
  message?: string;
  /** Hide the wordmark — useful in a small inset box where it crowds the mark. */
  showWordmark?: boolean;
  /** Hide the progress track, e.g. for a very short-lived gate. */
  showProgress?: boolean;
  /** 0–100 for a real percentage. Omitted means the indeterminate sweep. */
  progress?: number;
  className?: string;
}

export function StayoLoadingScreen({
  variant = 'screen',
  message,
  showWordmark = true,
  showProgress = true,
  progress,
  className,
}: StayoLoadingScreenProps) {
  const rotates = message === undefined;
  const [line, setLine] = useState<string>(STAYO_LOADING_LINES[0]);
  const [fading, setFading] = useState(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!rotates) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let index = 0;
    const rotate = setInterval(() => {
      setFading(true);
      fadeTimer.current = setTimeout(() => {
        index = (index + 1) % STAYO_LOADING_LINES.length;
        setLine(STAYO_LOADING_LINES[index]);
        setFading(false);
      }, FADE_MS);
    }, ROTATE_MS);

    return () => {
      clearInterval(rotate);
      clearTimeout(fadeTimer.current);
    };
  }, [rotates]);

  const copy = rotates ? `${line}…` : message;
  const determinate = typeof progress === 'number';

  return (
    <div
      className={cn(
        'stayo-load stayo-load__stage',
        variant === 'screen' && 'stayo-load__stage--screen',
        variant === 'inset' && 'stayo-load__stage--inset',
        variant === 'overlay' && 'stayo-load__stage--inset stayo-load__stage--overlay',
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="stayo-load__particles" aria-hidden="true">
        {PARTICLES.map((p) => (
          <span
            key={p.left}
            className="stayo-load__particle"
            style={{
              left: `${p.left}%`,
              width: p.size,
              height: p.size,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
              opacity: p.opacity,
            }}
          />
        ))}
      </div>

      <div className="stayo-load__glow" aria-hidden="true" />

      <div className="stayo-load__logo">
        <StayoMark panes="loading" className="stayo-load__mark" style={{ color: '#c0552f' }} />
        {showWordmark ? <StayoWordmark className="stayo-load__wordmark" style={{ color: '#c0552f' }} /> : null}
      </div>

      {copy || showProgress ? (
        <div className="stayo-load__status">
          {copy ? (
            <p className={cn('stayo-load__copy', fading && 'stayo-load__copy--out')}>{copy}</p>
          ) : null}
          {showProgress ? (
            <div
              className="stayo-load__track"
              role={determinate ? 'progressbar' : undefined}
              aria-valuenow={determinate ? Math.round(progress) : undefined}
              aria-valuemin={determinate ? 0 : undefined}
              aria-valuemax={determinate ? 100 : undefined}
            >
              <div
                className={cn('stayo-load__fill', determinate && 'stayo-load__fill--determinate')}
                style={determinate ? { width: `${Math.min(100, Math.max(0, progress))}%` } : undefined}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
