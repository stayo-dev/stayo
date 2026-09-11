import type { ProgressView } from '../importProgress';

interface ImportRunStepProps {
  progress: ProgressView;
  onDone: () => void;
}

/**
 * A real bar, not a spinner: confirm is chunked, so there is a genuine
 * numerator and denominator. The copy never claims completion while rows
 * remain — an owner who closes the tab on a half-finished import has no way
 * to know that is what they did.
 */
export function ImportRunStep({ progress, onDone }: ImportRunStepProps) {
  return (
    <div className="space-y-4">
      <p className="font-display text-sm font-bold text-foreground">{progress.headline}</p>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      <ul className="space-y-1.5 text-[12.5px] font-medium text-muted-foreground">
        {progress.lines.map((line) => (
          <li key={line}>· {line}</li>
        ))}
      </ul>

      {progress.failureNote && (
        <p className="rounded-xl border border-destructive/25 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-destructive">
          {progress.failureNote}
        </p>
      )}

      {progress.done && (
        <button
          type="button"
          onClick={onDone}
          className="w-full rounded-xl border border-border py-3.5 font-display text-sm font-bold text-foreground"
        >
          Done
        </button>
      )}
    </div>
  );
}
