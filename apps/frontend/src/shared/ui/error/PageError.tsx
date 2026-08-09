import type { HmsError, ErrorCategory } from '@lib/errors';
import { getHmsError } from '@lib/errors';
import { StayoErrorScreen, type StayoErrorTone } from '@shared/ui/brand';

/**
 * Whole-surface error state — a route boundary, a page that failed to load, a
 * section that has nothing to show. Renders the Stayo error screen (the loading
 * screen with the lights out), so a failure looks like part of the product
 * rather than a browser default.
 *
 * The props are unchanged from the previous red-alert version on purpose; every
 * existing caller keeps working. Only the surface changed.
 */

const CATEGORY_TONE: Record<ErrorCategory, StayoErrorTone> = {
  auth: 'auth',
  permission: 'auth',
  network: 'network',
  payment: 'generic',
  validation: 'generic',
  tenant: 'generic',
  document: 'generic',
  not_found: 'notFound',
  server: 'server',
  generic: 'generic',
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

  // Only in dev: production users get the human copy and the button, nothing else.
  const detail =
    import.meta.env.DEV && error instanceof Error
      ? [error.message, error.stack].filter(Boolean).join('\n\n')
      : undefined;

  return (
    <StayoErrorScreen
      tone={CATEGORY_TONE[resolved.category] ?? 'generic'}
      title={title ?? resolved.title}
      description={description ?? resolved.description}
      hint={action ?? resolved.action}
      onRetry={onRetry}
      retryLabel={retryLabel}
      detail={detail}
      variant={fullScreen ? 'screen' : 'inset'}
      className={className}
    />
  );
}
