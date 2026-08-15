import { useCallback, useState } from 'react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { resolveError, toErrorLine, type ErrorContext, type ResolvedError } from './resolveError';

/**
 * One place errors are shown, so no surface has to decide how.
 *
 * Before this, 137 call sites each wrote their own
 * `error?.response?.data?.error?.message || 'fallback'` into a toast. The
 * wording drifted, the backend's `code` was discarded everywhere, and guidance
 * that needed to persist was put in something that disappears after 2.4s.
 *
 * `severity` decides the vessel, once:
 *
 *   recoverable → toast      nothing to decide
 *   needs-step  → inline     rendered where the user was working
 *   blocking    → dialog     takes over; they cannot continue regardless
 */
export function useErrorSurface(context: ErrorContext = 'generic') {
  const [error, setError] = useState<ResolvedError | null>(null);

  const show = useCallback(
    (thrown: unknown): ResolvedError => {
      const resolved = resolveError(thrown, context);

      if (resolved.severity === 'recoverable') {
        // Nothing to act on, so it does not earn space on the screen.
        stayoToast.error(toErrorLine(resolved));
      } else {
        setError(resolved);
      }

      return resolved;
    },
    [context],
  );

  const clear = useCallback(() => setError(null), []);

  return {
    /** Non-null only for `needs-step` and `blocking`. */
    error,
    /** Render <ErrorNotice> for this one. */
    inlineError: error?.severity === 'needs-step' ? error : null,
    /** Render <ErrorDialog> for this one. */
    blockingError: error?.severity === 'blocking' ? error : null,
    show,
    clear,
  };
}

/**
 * For call sites with genuinely nowhere to render — a background refresh, or a
 * mutation fired from a list row with no error slot.
 *
 * Still an improvement on the old pattern: the line it shows carries the next
 * step, not just what failed. Prefer `useErrorSurface` where there is room,
 * because a next step in a 2.4-second toast is easy to miss.
 */
export function toastError(thrown: unknown, context: ErrorContext = 'generic'): ResolvedError {
  const resolved = resolveError(thrown, context);
  stayoToast.error(toErrorLine(resolved));
  return resolved;
}
