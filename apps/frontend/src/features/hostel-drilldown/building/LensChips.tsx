import { X } from 'lucide-react';
import type { Lens, SlotCounts } from './buildingModel';

const CHIPS: Array<{ lens: Lens; count: (c: SlotCounts) => number; one: string; many: string; tone: string }> = [
  { lens: 'free', count: (c) => c.free, one: 'free bed', many: 'free beds', tone: 'text-success' },
  { lens: 'overdue', count: (c) => c.overdue, one: 'overdue', many: 'overdue', tone: 'text-destructive' },
  { lens: 'invited', count: (c) => c.invited, one: 'invited', many: 'invited', tone: 'text-warning' },
];

/**
 * The three numbers an owner opens this page for — and the way to find them.
 * Tapping one fades everyone else on the building and lights up the beds it
 * counts; tapping it again clears. A zero can't be tapped: there would be
 * nothing to light.
 */
export function LensChips({ counts, lens, onChange }: { counts: SlotCounts; lens: Lens | null; onChange: (lens: Lens | null) => void }) {
  return (
    <div className="flex gap-2" role="group" aria-label="Show on the building">
      {CHIPS.map((chip) => {
        const n = chip.count(counts);
        const on = lens === chip.lens;
        return (
          <button
            key={chip.lens}
            type="button"
            aria-pressed={on}
            disabled={n === 0 && !on}
            onClick={() => onChange(on ? null : chip.lens)}
            className={`relative flex min-w-0 flex-1 flex-col items-start rounded-2xl border p-2.5 text-left shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)] transition-colors disabled:opacity-55 ${
              on ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-foreground'
            }`}
          >
            <span className={`font-display text-base font-extrabold tabular-nums ${on ? 'text-background' : chip.tone}`}>{n}</span>
            <span className={`truncate text-[10.5px] ${on ? 'text-background/80' : 'text-muted-foreground'}`}>{n === 1 ? chip.one : chip.many}</span>
            {on && <X className="absolute right-2 top-2 h-3 w-3 text-background/70" strokeWidth={2.5} aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
