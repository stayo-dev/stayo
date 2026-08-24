import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { eyebrow, h1, sub, fieldLabel, fieldHint, stepBtn } from '@features/owner-onboarding/components/stepStyles';
import { defaultFloorName } from '../hostelBuilder';

const MAX_FLOORS = 12;

/**
 * How many floors, and what they're called.
 *
 * Floor names are editable here: the onboarding version rendered an "Edit"
 * affordance on each generated floor that did nothing at all.
 *
 * This screen used to say "Watch it go up" and "(only 5 fit in the picture)",
 * describing the animated building that sat behind it — which was removed from
 * this page in Aug 2026 and now only appears in the onboarding wizard. The
 * copy outlived the illustration, so the owner was told to watch something
 * that was not on screen.
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
      <p className={sub}>Count the floors you rent out. Rename any of them below — and you can add or remove floors later from the Rooms tab.</p>

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
          <span className="text-[12px] font-medium text-muted-foreground">
            {count === 1 ? 'floor' : 'floors'}
          </span>
        </div>
        <span className={fieldHint}>Include the ground floor if there are rooms on it.</span>
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
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  // Every step lives inside the page's form now, so a bare
                  // Enter here would submit the wizard instead of finishing
                  // the rename.
                  e.preventDefault();
                  setEditing(null);
                }}
                className="min-w-0 flex-1 rounded-lg border-[1.5px] border-primary bg-input-background px-2.5 py-1.5 font-display text-[14.5px] font-bold text-foreground focus:outline-none focus:ring-4 focus:ring-primary/15"
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
