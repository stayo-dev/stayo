import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@shared/lib/cn';
import { HOSTEL_SORT_OPTIONS, type HostelSortMode } from './hostelSort';

/**
 * Sort selector for the Home "Property" list.
 *
 * A popover rather than a row of chips: at five options chips would wrap on a
 * 430px viewport and crowd out the "+ Add hostel" action, and the current
 * mode needs to stay readable at a glance since it explains why the drag
 * handles are or aren't there.
 */
export function PropertySortControl({
  mode,
  onChange,
  className,
}: {
  mode: HostelSortMode;
  onChange: (mode: HostelSortMode) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = HOSTEL_SORT_OPTIONS.find((o) => o.mode === mode) ?? HOSTEL_SORT_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Sort properties: ${current.label}`}
        className={cn(
          'flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-semibold',
          'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          open && 'bg-muted text-foreground',
        )}
      >
        <span className="tabular-nums">{current.short}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Sort properties"
          className="absolute right-0 top-full z-30 mt-1 min-w-[11.5rem] overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        >
          {HOSTEL_SORT_OPTIONS.map((option) => {
            const selected = option.mode === mode;
            return (
              <button
                key={option.mode}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option.mode);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[13px]',
                  'transition-colors hover:bg-muted',
                  selected ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                <span>{option.label}</span>
                {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
