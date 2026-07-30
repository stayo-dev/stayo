import { RefreshCw, WifiOff, Lock, ServerCrash, AlertCircle } from 'lucide-react';
import type { HmsError, ErrorCategory } from '@lib/errors';
import { getHmsError } from '@lib/errors';

const CATEGORY_CONFIG: Record<ErrorCategory, { icon: React.ElementType; iconBg: string; iconColor: string }> = {
  auth:       { icon: Lock,        iconBg: 'bg-amber-100',  iconColor: 'text-amber-600' },
  permission: { icon: Lock,        iconBg: 'bg-amber-100',  iconColor: 'text-amber-600' },
  network:    { icon: WifiOff,     iconBg: 'bg-blue-100',   iconColor: 'text-blue-600' },
  payment:    { icon: AlertCircle, iconBg: 'bg-red-100',    iconColor: 'text-red-600' },
  validation: { icon: AlertCircle, iconBg: 'bg-orange-100', iconColor: 'text-orange-600' },
  tenant:     { icon: AlertCircle, iconBg: 'bg-red-100',    iconColor: 'text-red-600' },
  document:   { icon: AlertCircle, iconBg: 'bg-orange-100', iconColor: 'text-orange-600' },
  not_found:  { icon: AlertCircle, iconBg: 'bg-gray-100',   iconColor: 'text-gray-500' },
  server:     { icon: ServerCrash, iconBg: 'bg-red-100',    iconColor: 'text-red-600' },
  generic:    { icon: AlertCircle, iconBg: 'bg-red-100',    iconColor: 'text-red-600' },
};

interface PageErrorProps {
  error?: HmsError | unknown;
  title?: string;
  description?: string;
  action?: string;
  onRetry?: () => void;
  retryLabel?: string;
  fullScreen?: boolean;
  className?: string;
}

export function PageError({
  error,
  title,
  description,
  action,
  onRetry,
  retryLabel = 'Try again',
  fullScreen = false,
  className = '',
}: PageErrorProps) {
  let resolved: HmsError;
  if (error && typeof error === 'object' && 'title' in error && 'description' in error) {
    resolved = error as HmsError;
  } else if (error) {
    resolved = getHmsError(error);
  } else {
    resolved = {
      title: title ?? 'Something went wrong',
      description: description ?? 'An unexpected error occurred.',
      action: action ?? 'Try again or contact support.',
      retryable: !!onRetry,
      category: 'generic',
    };
  }

  const finalTitle = title ?? resolved.title;
  const finalDescription = description ?? resolved.description;
  const finalAction = action ?? resolved.action;
  const cfg = CATEGORY_CONFIG[resolved.category] ?? CATEGORY_CONFIG.generic;
  const Icon = cfg.icon;

  const wrapperClass = fullScreen
    ? `min-h-screen flex items-center justify-center p-6 bg-background ${className}`
    : `flex flex-col items-center justify-center py-20 px-6 text-center ${className}`;

  return (
    <div className={wrapperClass} role="alert" aria-live="assertive">
      <div className="max-w-sm w-full flex flex-col items-center text-center">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-5 ${cfg.iconBg}`}>
          <Icon className={`w-7 h-7 ${cfg.iconColor}`} aria-hidden="true" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">{finalTitle}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{finalDescription}</p>
        {finalAction && (
          <p className="text-sm text-muted-foreground mt-2 font-medium">&rarr; {finalAction}</p>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-7 flex items-center gap-2 px-6 py-3 rounded-xl bg-accent text-accent-foreground text-sm font-semibold active:scale-95 transition-transform"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
