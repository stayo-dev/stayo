/**
 * Stayo's error surface: what happened, why, and what to do next.
 *
 * See `resolveError.ts` for the reasoning — in short, an error that only says
 * what failed leaves the user guessing, and guidance shown in a toast that
 * self-dismisses is guidance nobody reads.
 */
export {
  resolveError,
  extractError,
  interpolate,
  toErrorLine,
  type ResolvedError,
  type ErrorSeverity,
  type ErrorContext,
  type ErrorActionIntent,
} from './resolveError';
export { ErrorNotice, ErrorDialog } from './ErrorNotice';
export { useErrorSurface, toastError } from './useErrorSurface';
