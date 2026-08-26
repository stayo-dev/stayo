import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import { REVIEW_SORT_OPTIONS, type ReviewSortMode } from '../reviewSort';
import { C, FONT } from '../discoverTheme';

/**
 * Sort dropdown for the dedicated Reviews page. Discover-native retheme of
 * `features/owner-dashboard/property-order/PropertySortControl.tsx`'s
 * pattern (controlled popover/listbox, closes on outside click or Escape)
 * using `discoverTheme`'s `C`/`FONT` instead of shadcn tokens — Discover's
 * own "tap to cycle" sort button doesn't scale past 3 states and isn't
 * discoverable, so this is a real listbox instead.
 */
export function ReviewsSortControl({
  mode,
  onChange,
}: {
  mode: ReviewSortMode;
  onChange: (mode: ReviewSortMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = REVIEW_SORT_OPTIONS.find((option) => option.mode === mode) ?? REVIEW_SORT_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex-none">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Sort reviews: ${current.label}`}
        className="flex items-center gap-1.5 rounded-full border bg-white px-3.5 py-2"
        style={{ borderColor: C.lineInput }}
      >
        <span className="text-[12px] font-semibold" style={{ color: C.textBody }}>
          {current.label}
        </span>
        <ChevronDown
          className="h-3.5 w-3.5 transition-transform"
          style={{ color: C.textMuted, transform: open ? 'rotate(180deg)' : undefined }}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full z-30 mt-1 min-w-[11.5rem] overflow-hidden rounded-xl border bg-white shadow-lg"
          style={{ borderColor: C.line }}
        >
          {REVIEW_SORT_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              role="option"
              aria-selected={option.mode === mode}
              onClick={() => {
                onChange(option.mode);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-[12.5px] font-semibold"
              style={{ color: C.text, fontFamily: FONT.display }}
            >
              <span>{option.label}</span>
              {option.mode === mode && <Check className="h-3.5 w-3.5" style={{ color: C.clay }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
