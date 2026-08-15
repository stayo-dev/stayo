import { useEffect, useState } from 'react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';

/**
 * Edits exactly one thing.
 *
 * The previous workspace routed every row — name, room, rent, billing
 * frequency — into one 12-field form, so changing a rent meant scrolling past
 * hostel pickers and agreement dates. Each row now opens only itself, and
 * nothing is written to the server here: the value lands in the local draft
 * and is sent once, deliberately, from the review step.
 */

export type TermFieldKind = 'text' | 'phone' | 'email' | 'money' | 'date' | 'select' | 'months';

export interface TermEditSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Shown under the title — say what this affects, not what it is. */
  help?: string;
  kind: TermFieldKind;
  value: string;
  options?: Array<{ value: string; label: string }>;
  onSave: (value: string) => void;
  validate?: (value: string) => string | null;
}

const inputClass =
  'w-full rounded-xl border border-border bg-background px-4 py-3.5 text-[16px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40';

export function TermEditSheet({
  open,
  onClose,
  title,
  help,
  kind,
  value,
  options = [],
  onSave,
  validate,
}: TermEditSheetProps) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  // Reopening the sheet must show what is currently in the draft, not what was
  // there the last time this sheet happened to be mounted.
  useEffect(() => {
    if (open) {
      setDraft(value);
      setError(null);
    }
  }, [open, value]);

  const handleSave = () => {
    const message = validate?.(draft) ?? null;
    if (message) {
      setError(message);
      return;
    }
    onSave(draft);
    onClose();
  };

  return (
    <BottomSheet open={open} onOpenChange={(next) => !next && onClose()} title={title}>
      <div className="flex flex-col gap-4">
        {help && <p className="-mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{help}</p>}

        {kind === 'select' ? (
          <select value={draft} onChange={(e) => setDraft(e.target.value)} className={inputClass}>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="relative">
            {kind === 'money' && (
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[16px] font-bold text-muted-foreground">
                ₹
              </span>
            )}
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              type={kind === 'date' ? 'date' : kind === 'money' || kind === 'months' ? 'number' : kind === 'email' ? 'email' : kind === 'phone' ? 'tel' : 'text'}
              inputMode={kind === 'money' || kind === 'months' ? 'numeric' : kind === 'phone' ? 'tel' : undefined}
              min={kind === 'money' || kind === 'months' ? 0 : undefined}
              className={`${inputClass} ${kind === 'money' ? 'pl-9' : ''}`}
            />
          </div>
        )}

        {error && <p className="text-[12.5px] font-semibold text-destructive">{error}</p>}

        <div className="flex gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] flex-1 rounded-xl border border-border bg-card font-display text-[14px] font-bold text-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="min-h-[48px] flex-1 rounded-xl bg-primary font-display text-[14px] font-bold text-primary-foreground shadow-sm active:scale-[0.98] transition-transform"
          >
            Done
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
