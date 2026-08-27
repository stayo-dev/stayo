import { useEffect, useState } from 'react';
import { FOOD_SLOTS } from '@shared/mocks/food';
import type { MealTimingEntry, MealTimings } from '@features/food/mealTimings';
import { hasChanges } from '@features/owner-more/config/dirtyState';
import { mealIcon } from '../../mealIcons';

interface MealTimingsFormProps {
  mealTimings: MealTimings;
  onSave: (next: MealTimings) => void;
  isSaving: boolean;
}

/**
 * The 4-row serving-window editor — extracted verbatim from the retired
 * standalone `MealTimingsPage` (ADR-121) so it can be reused inside Meal
 * Plan's "Edit timings" sheet. Same draft-seed/dirty-check/save logic as
 * before; `useMealTimings` (the one hook backing `GET/PATCH
 * /api/hostels/:id/meal-timings`) stays the single source of truth — this
 * component owns no state beyond the local editing draft.
 */
export function MealTimingsForm({ mealTimings, onSave, isSaving }: MealTimingsFormProps) {
  const [draft, setDraft] = useState<MealTimings>(mealTimings);

  useEffect(() => {
    setDraft(mealTimings);
  }, [mealTimings]);

  const dirty = hasChanges(mealTimings, draft);
  const invalid = FOOD_SLOTS.some((s) => draft[s.key].start >= draft[s.key].end);

  const updateEntry = (key: keyof MealTimings, patch: Partial<MealTimingEntry>) => {
    setDraft((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2.5">
        {FOOD_SLOTS.map((slotMeta) => {
          const Icon = mealIcon(slotMeta.key);
          const entry = draft[slotMeta.key];
          const rangeInvalid = entry.start >= entry.end;
          return (
            <div
              key={slotMeta.key}
              className={`rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)] ${
                entry.enabled ? '' : 'opacity-60'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[11px]" style={{ background: slotMeta.tint }}>
                  <Icon className="h-4 w-4" style={{ color: slotMeta.color }} strokeWidth={1.9} />
                </span>
                <span className="min-w-0 flex-1 font-display text-[14.5px] font-bold text-foreground">{slotMeta.label}</span>
                <button
                  type="button"
                  onClick={() => updateEntry(slotMeta.key, { enabled: !entry.enabled })}
                  className={`flex-none rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    entry.enabled ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {entry.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2.5">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Starts</span>
                  <input
                    type="time"
                    value={entry.start}
                    disabled={!entry.enabled}
                    onChange={(e) => updateEntry(slotMeta.key, { start: e.target.value })}
                    className="min-h-[44px] rounded-xl border border-border bg-background px-3 text-[13px] disabled:opacity-50"
                  />
                </label>
                <span className="mt-4 text-muted-foreground">–</span>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Ends</span>
                  <input
                    type="time"
                    value={entry.end}
                    disabled={!entry.enabled}
                    onChange={(e) => updateEntry(slotMeta.key, { end: e.target.value })}
                    className="min-h-[44px] rounded-xl border border-border bg-background px-3 text-[13px] disabled:opacity-50"
                  />
                </label>
              </div>
              {entry.enabled && rangeInvalid && <p className="mt-2 text-[11.5px] font-semibold text-destructive">Start time must be before end time.</p>}
            </div>
          );
        })}
      </div>

      {dirty && (
        <button
          type="button"
          disabled={invalid || isSaving}
          onClick={() => onSave(draft)}
          className="min-h-[44px] rounded-xl bg-primary py-3.5 text-center font-display text-[13.5px] font-bold text-primary-foreground shadow-[0_8px_20px_rgba(180,106,85,0.32)] disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : 'Save Meal Timings'}
        </button>
      )}
    </div>
  );
}
