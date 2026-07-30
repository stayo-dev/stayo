import { AlertCircle, WifiOff, Lock, CreditCard, RefreshCw, ServerCrash } from 'lucide-react';
import type { HmsError, ErrorCategory } from '@lib/errors';
import { getHmsError } from '@lib/errors';

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
        className={`flex items-start gap-3 px-4 py-3 rounded-xl border border-red-200 bg-red-50 ${className}`}
      >
        <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-red-700">{finalTitle}</p>
          <p className="text-xs text-red-600 mt-0.5">{finalDescription}</p>
          {finalAction && (
            <p className="text-xs text-red-500 mt-1 font-medium">&rarr; {finalAction}</p>
          )}
          {canRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 text-xs font-semibold text-red-700 underline underline-offset-2 hover:text-red-900 transition-colors"
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
      className={`flex items-start gap-4 px-5 py-4 rounded-2xl border border-red-200 bg-red-50 ${className}`}
    >
      <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-red-600" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-red-700">{finalTitle}</p>
        <p className="text-sm text-red-600 mt-0.5 leading-relaxed">{finalDescription}</p>
        {finalAction && (
          <p className="text-xs text-red-500 font-semibold mt-1.5">&rarr; {finalAction}</p>
        )}
        {canRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-red-700 hover:text-red-900 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
