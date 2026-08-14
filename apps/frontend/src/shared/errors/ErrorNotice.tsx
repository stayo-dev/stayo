import { AlertTriangle, RefreshCw, ArrowLeft, KeyRound, LogIn, LifeBuoy, Wifi } from 'lucide-react';
import type { ErrorActionIntent, ResolvedError } from './resolveError';

/**
 * An error, shown where the user was working, that stays until it is resolved.
 *
 * This is the vessel for anything carrying a next step. The app's toast
 * auto-dismisses after 2.4 seconds, which is fine for "Saved" and useless for
 * "here is why that failed and what to do" — a user who looks away loses the
 * only guidance they were given, and cannot get it back.
 *
 * The code is always printed. It is the one thing that turns "it's broken"
 * into a support conversation that can actually go somewhere.
 */

const INTENT_ICON: Record<ErrorActionIntent, typeof RefreshCw> = {
  RETRY: RefreshCw,
  SIGN_IN: LogIn,
  CONFIRM_PASSWORD: KeyRound,
  CHECK_CONNECTION: Wifi,
  CONTACT_SUPPORT: LifeBuoy,
  GO_BACK: ArrowLeft,
};

export function ErrorNotice({
  error,
  onAction,
  className = '',
}: {
  error: ResolvedError;
  /** The surface decides what an intent means — this component never navigates. */
  onAction?: (intent: ErrorActionIntent) => void;
  className?: string;
}) {
  const ActionIcon = error.action ? INTENT_ICON[error.action.intent] : null;

  return (
    <div
      role="alert"
      className={`rounded-2xl border border-destructive/20 bg-destructive/5 p-3.5 ${className}`}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-destructive" strokeWidth={2.2} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-[13.5px] font-bold leading-snug text-foreground">{error.title}</p>

          {/* Omitted entirely when unknown, rather than padded with a guess. */}
          {error.why && <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{error.why}</p>}

          <p className="mt-1.5 text-[12.5px] font-semibold leading-relaxed text-foreground">{error.nextStep}</p>

          {error.action && onAction && (
            <button
              type="button"
              onClick={() => onAction(error.action!.intent)}
              className="mt-2.5 inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-foreground px-3.5 font-display text-[12.5px] font-bold text-background active:scale-[0.98] transition-transform"
            >
              {ActionIcon && <ActionIcon className="h-3.5 w-3.5" strokeWidth={2.2} />}
              {error.action.label}
            </button>
          )}

          <p className="mt-2 font-mono text-[10.5px] text-muted-foreground/70">
            {error.code}
            {error.status ? ` · ${error.status}` : ''}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The blocking case — the user cannot continue until they act, so it takes
 * over rather than waiting to be noticed. Deliberately has no dismiss: a
 * dismissable "your session ended" just puts the user back on a dead screen.
 */
export function ErrorDialog({
  error,
  onAction,
  onDismiss,
}: {
  error: ResolvedError;
  onAction?: (intent: ErrorActionIntent) => void;
  /** Omit for genuinely unrecoverable states. */
  onDismiss?: () => void;
}) {
  const ActionIcon = error.action ? INTENT_ICON[error.action.intent] : null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[rgba(28,20,14,0.55)] p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-[0_24px_60px_rgba(40,30,20,0.28)]"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-destructive/10">
          <AlertTriangle className="h-5 w-5 text-destructive" strokeWidth={2} />
        </span>

        <h2 className="mt-3.5 font-display text-[17px] font-extrabold leading-snug text-foreground">{error.title}</h2>
        {error.why && <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{error.why}</p>}
        <p className="mt-2 text-[13px] font-semibold leading-relaxed text-foreground">{error.nextStep}</p>

        <div className="mt-4 flex gap-2.5">
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="min-h-[46px] flex-1 rounded-xl border border-border bg-card font-display text-[13.5px] font-bold text-foreground hover:bg-muted"
            >
              Not now
            </button>
          )}
          {error.action && onAction && (
            <button
              type="button"
              onClick={() => onAction(error.action!.intent)}
              className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary font-display text-[13.5px] font-bold text-primary-foreground active:scale-[0.98] transition-transform"
            >
              {ActionIcon && <ActionIcon className="h-4 w-4" strokeWidth={2.2} />}
              {error.action.label}
            </button>
          )}
        </div>

        <p className="mt-3 text-center font-mono text-[10.5px] text-muted-foreground/70">
          {error.code}
          {error.status ? ` · ${error.status}` : ''}
        </p>
      </div>
    </div>
  );
}
