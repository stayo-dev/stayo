/*
 * StayoErrorScreen — the loading screen's other half.
 *
 * Same warm sky, same mark, same typography as <StayoLoadingScreen />; the
 * difference is that the windows never light. One gutters. The metaphor stays
 * inside the brand — "nobody's home yet" — instead of switching to the generic
 * red-alert language the app used to reach for, which made a flaky Wi-Fi
 * moment look like a data loss.
 *
 * Severity is carried by the badge icon and the copy, not by repainting the
 * screen: a `network` error and a `server` error look equally calm, because in
 * both cases the only useful thing the person can do is read one line and press
 * one button.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Lock, RefreshCw, SearchX, ServerCrash, WifiOff } from 'lucide-react';
import { cn } from '@shared/lib/cn';

import { StayoMark } from './StayoMark';
import './stayo-loading.css';

export type StayoErrorTone = 'network' | 'auth' | 'notFound' | 'server' | 'generic';

const TONE_ICON: Record<StayoErrorTone, typeof AlertTriangle> = {
  network: WifiOff,
  auth: Lock,
  notFound: SearchX,
  server: ServerCrash,
  generic: AlertTriangle,
};

export interface StayoErrorScreenProps {
  /** Picks the badge icon. Everything else is identical across tones by design. */
  tone?: StayoErrorTone;
  title: string;
  description?: string;
  /** One concrete next step, rendered as "→ Check your connection and try again." */
  hint?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** A second, quieter action — "Go home", "Contact support". */
  secondaryAction?: ReactNode;
  /**
   * Technical detail, collapsed behind a disclosure. Never shown expanded:
   * the person who needs a stack trace will open it, and nobody else should
   * have to read past it to find the button.
   */
  detail?: string;
  /** `screen` fills the viewport; `inset` fills its parent box. */
  variant?: 'screen' | 'inset';
  className?: string;
}

export function StayoErrorScreen({
  tone = 'generic',
  title,
  description,
  hint,
  onRetry,
  retryLabel = 'Try again',
  secondaryAction,
  detail,
  variant = 'inset',
  className,
}: StayoErrorScreenProps) {
  const Icon = TONE_ICON[tone];

  return (
    <div
      className={cn(
        'stayo-load stayo-load__stage stayo-load__stage--muted',
        variant === 'screen' ? 'stayo-load__stage--screen' : 'stayo-load__stage--inset',
        className,
      )}
      role="alert"
      aria-live="assertive"
    >
      <div className="stayo-load__glow" aria-hidden="true" />

      <div className="stayo-load__logo">
        <div className="relative" style={{ width: 'clamp(96px, 16vw, 140px)' }}>
          <StayoMark panes="dark" style={{ width: '100%', height: 'auto', color: '#c0552f' }} />
          <span className="stayo-load__badge" aria-hidden="true">
            <Icon strokeWidth={2.4} />
          </span>
        </div>
      </div>

      <div className="stayo-load__status" style={{ gap: 12 }}>
        <h2 className="stayo-load__title">{title}</h2>
        {description ? <p className="stayo-load__body">{description}</p> : null}
        {hint ? <p className="stayo-load__hint">&rarr; {hint}</p> : null}

        {onRetry || secondaryAction ? (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            {onRetry ? (
              <button type="button" onClick={onRetry} className="stayo-load__button">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {retryLabel}
              </button>
            ) : null}
            {secondaryAction}
          </div>
        ) : null}

        {detail ? (
          <details className="stayo-load__detail mt-4">
            <summary>Technical detail</summary>
            <pre>{detail}</pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
