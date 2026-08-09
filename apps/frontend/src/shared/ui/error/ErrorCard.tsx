import { AlertCircle, WifiOff, Lock, CreditCard, RefreshCw, ServerCrash } from 'lucide-react';
import type { HmsError, ErrorCategory } from '@lib/errors';
import { getHmsError } from '@lib/errors';
import { cn } from '@shared/lib/cn';

/**
 * In-place error state for one card, list or form section — the small sibling
 * of `PageError` (which takes over a whole surface with the Stayo error
 * screen). Used where the rest of the page is still usable and only this piece
 * failed.
 *
 * Styled from the theme's `destructive` tokens rather than raw `red-*`
 * utilities: Stayo's destructive is a warm brick (#b3402f) that sits inside the
 * brand's palette, where Tailwind red reads as a browser warning pasted on top
 * of it. Same reason the radii and weights match the product's cards.
 */

const CATEGORY_ICON: Record<ErrorCategory, React.ElementType> = {
  auth: Lock,
  permission: Lock,
  network: WifiOff,
  payment: CreditCard,
  validation: AlertCircle,
  tenant: AlertCircle,
  document: AlertCircle,
  not_found: AlertCircle,
  server: ServerCrash,
  generic: AlertCircle,
};

interface ErrorCardProps {
  error?: HmsError | unknown;
  title?: string;
  description?: string;
  action?: string;
  retryable?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
  className?: string;
  role?: string;
}

function resolveError(error: HmsError | unknown | undefined): HmsError {
  if (!error) {
    return {
      title: 'Something went wrong',
      description: 'An unexpected error occurred.',
      action: 'Try again or contact support.',
      retryable: true,
      category: 'generic',
    };
  }
  if (typeof error === 'object' && error !== null && 'title' in error && 'description' in error) {
    return error as HmsError;
  }
  return getHmsError(error);
}

export function ErrorCard({
  error,
  title,
  description,
  action,
  retryable,
  onRetry,
  retryLabel = 'Try again',
  compact = false,
  className = '',
  role = 'alert',
}: ErrorCardProps) {
  const resolved = resolveError(error);
  const finalTitle = title ?? resolved.title;
  const finalDescription = description ?? resolved.description;
  const finalAction = action ?? resolved.action;
  const canRetry = (retryable ?? resolved.retryable) && !!onRetry;
  const Icon = CATEGORY_ICON[resolved.category] ?? AlertCircle;

  if (compact) {
    return (
      <div
        role={role}
        aria-live="polite"
        className={cn(
          'flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/[0.06] px-4 py-3',
          className,
        )}
      >
        <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-display text-sm font-bold text-destructive">{finalTitle}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{finalDescription}</p>
          {finalAction && (
            <p className="mt-1 text-xs font-semibold text-destructive/85">&rarr; {finalAction}</p>
          )}
          {canRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 text-xs font-bold text-destructive underline underline-offset-2 transition-opacity hover:opacity-75"
            >
              {retryLabel}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      role={role}
      aria-live="polite"
      className={cn(
        'flex items-start gap-4 rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-5 py-4',
        className,
      )}
    >
      <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-bold text-destructive">{finalTitle}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{finalDescription}</p>
        {finalAction && (
          <p className="mt-1.5 text-xs font-semibold text-destructive/85">&rarr; {finalAction}</p>
        )}
        {canRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 flex items-center gap-1.5 text-sm font-bold text-destructive transition-opacity hover:opacity-75"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
