import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import type { OwnerSessionHostel } from '@features/owner-session/types';

interface HostelSwitcherProps {
  hostels: OwnerSessionHostel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Renders nothing for a single-hostel owner — zero friction where there is no
 * choice to make. For everyone else it is mandatory: this screen once read
 * `hostels[0]` with no way to reach any other property's food.
 *
 * A native `<select>` was the first attempt and overflowed the viewport: it
 * sizes itself to its longest option, so a real hostel name pushed the control
 * off-screen. A trigger with a fixed max width plus the app's BottomSheet keeps
 * the header stable at any name length, and shows names in full rather than
 * truncating the one thing the control exists to disambiguate.
 */
export function HostelSwitcher({ hostels, selectedId, onSelect }: HostelSwitcherProps) {
  const [open, setOpen] = useState(false);
  if (hostels.length < 2) return null;

  const selected = hostels.find((h) => h.id === selectedId);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Choose hostel"
        className="flex min-h-[44px] max-w-[46vw] flex-none items-center gap-1.5 rounded-xl border border-border bg-card py-2.5 pl-3.5 pr-2.5 text-left"
      >
        <span className="truncate text-[12.5px] font-semibold text-foreground">
          {selected?.name ?? 'Choose hostel'}
        </span>
        <ChevronDown className="h-4 w-4 flex-none text-muted-foreground" />
      </button>

      <BottomSheet open={open} onOpenChange={setOpen} title="Choose hostel">
        <div className="flex flex-col gap-1.5 pb-2">
          {hostels.map((h) => {
            const isSelected = h.id === selectedId;
            return (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  onSelect(h.id);
                  setOpen(false);
                }}
                className={`flex min-h-[44px] items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left ${
                  isSelected ? 'border-primary bg-secondary/40' : 'border-border bg-card'
                }`}
              >
                <span className="flex-1 text-[13.5px] font-semibold text-foreground">{h.name}</span>
                {isSelected && <Check className="h-4 w-4 flex-none text-primary" strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>
      </BottomSheet>
    </>
  );
}
