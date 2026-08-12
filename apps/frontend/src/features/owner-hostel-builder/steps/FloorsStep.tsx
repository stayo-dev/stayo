import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { eyebrow, h1, sub, fieldLabel, stepBtn } from '@features/owner-onboarding/components/stepStyles';
import { defaultFloorName } from '../hostelBuilder';
import { MAX_DRAWN_FLOORS } from '@shared/ui/brand';

const MAX_FLOORS = 12;

/**
 * How many floors, and what they're called.
 *
 * The building behind this screen gains a storey on every tap, which is the
 * whole point — the count is not an abstract number, it is the thing being
 * drawn. Floor names are editable here: the onboarding version rendered an
 * "Edit" affordance on each generated floor that did nothing at all.
 */
export function FloorsStep({
  count,
  onCountChange,
  names,
  onRename,
}: {
  count: number;
  onCountChange: (count: number) => void;
  names: string[];
  onRename: (index: number, name: string) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);

  return (
    <div>
      <div className={eyebrow}>RAISE THE FLOORS</div>
      <h1 className={h1}>How many floors?</h1>
      <p className={sub}>Watch it go up. You can rename any floor, and add or remove floors later.</p>

      <div className="mb-5 max-w-[440px]">
        <span className={fieldLabel}>NUMBER OF FLOORS</span>
        <div className="mt-2 flex items-center gap-3.5">
          <button type="button" aria-label="Fewer floors" onClick={() => onCountChange(Math.max(1, count - 1))} className={stepBtn}>
            −
          </button>
          <span className="min-w-[46px] text-center font-display text-3xl font-extrabold text-foreground">{count}</span>
          <button
            type="button"
            aria-label="More floors"
            onClick={() => onCountChange(Math.min(MAX_FLOORS, count + 1))}
            className={stepBtn}
          >
            +
          </button>
          {count > MAX_DRAWN_FLOORS && (
            <span className="text-[12px] font-medium text-muted-foreground">
              (only {MAX_DRAWN_FLOORS} fit in the picture)
            </span>
          )}
        </div>
      </div>

      <ul className="flex max-w-[440px] flex-col gap-2">
        {names.map((name, i) => (
          <li
            key={i}
            style={{ animation: 'stayoRiseIn .4s ease both', animationDelay: `${i * 70}ms` }}
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/90 px-4 py-3"
          >
            {editing === i ? (
              <input
                autoFocus
                value={name}
                onChange={(e) => onRename(i, e.target.value)}
                onBlur={() => setEditing(null)}
                onKeyDown={(e) => e.key === 'Enter' && setEditing(null)}
                className="min-w-0 flex-1 border-b-2 border-primary bg-transparent py-0.5 font-display text-[14.5px] font-bold text-foreground focus:outline-none"
              />
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate font-display text-[14.5px] font-bold text-foreground">
                  {name || defaultFloorName(i)}
                </span>
                <button
                  type="button"
                  onClick={() => setEditing(i)}
                  className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-semibold text-primary hover:bg-primary/10"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                  Rename
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
