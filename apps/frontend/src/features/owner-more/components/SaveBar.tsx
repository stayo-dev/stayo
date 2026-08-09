/**
 * The Save bar for configuration screens — mounted only when there is something
 * to save.
 *
 * Every config screen previously showed a permanent Save bar, which had two
 * costs: the owner could not tell an untouched screen from an edited one, and
 * saving a screen they had only read still issued a PATCH, bumping the policy
 * version and writing a change-log entry for a change that never happened.
 *
 * Whether anything changed is decided by `hasChanges` against a baseline taken
 * from the loaded policy (see config/dirtyState.ts), so retyping the same value
 * or toggling something off and back on leaves the screen clean.
 *
 * Discard is offered alongside Save because an appearing bar implies the edit is
 * pending — the owner needs a way back to where they started that isn't
 * "remember the old numbers and retype them".
 */
export function SaveBar({
  visible,
  onSave,
  onDiscard,
  label,
  pending,
}: {
  /** Usually `hasChanges(baseline, current)`. */
  visible: boolean;
  onSave: () => void;
  /** Omitted when a screen has no cheap way back to its loaded values. */
  onDiscard?: () => void;
  /** Button text, e.g. "Save deposit". */
  label: string;
  pending?: boolean;
}) {
  // Kept mounted while saving so the bar does not vanish mid-request when the
  // mutation optimistically settles the form back to a clean state.
  if (!visible && !pending) return null;

  return (
    <div className="stayo-save-bar fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-20 border-t border-border bg-background px-5 pb-[30px] pt-3 sm:mx-auto sm:max-w-[480px] sm:px-6">
      <div className="flex items-center gap-2.5">
        {onDiscard && (
          <button
            type="button"
            onClick={onDiscard}
            disabled={pending}
            className="rounded-xl border border-border px-4 py-3.5 font-display text-sm font-bold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
          >
            Discard
          </button>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="flex-1 rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground shadow-[0_6px_16px_rgba(164,93,68,0.28)] disabled:opacity-60"
        >
          {pending ? 'Saving…' : label}
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        {pending ? 'Saving your changes…' : 'You have unsaved changes'}
      </p>
    </div>
  );
}
