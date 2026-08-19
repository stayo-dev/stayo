import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { FOOD_SLOTS } from '@shared/mocks/food';
import type { MealTimingEntry, MealTimings } from '@features/food/mealTimings';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { hasChanges } from '@features/owner-more/config/dirtyState';
import { HostelSwitcher } from '../components/HostelSwitcher';
import { useMealTimings } from '../hooks/useMealTimings';
import { mealIcon } from '../mealIcons';

/**
 * Owner-configured serving windows for this hostel — permanent config, not
 * the changing weekly menu. Route `/owner/food/meal-timings`, hostel carried
 * on `?hostelId=`, same convention as the Kitchen sheet and Food Polls.
 */
export function MealTimingsPage() {
  const session = useOwnerSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const hostelId = searchParams.get('hostelId') ?? session.primaryHostelId ?? undefined;

  const query = useMealTimings(hostelId);
  const [draft, setDraft] = useState<MealTimings | null>(null);

  // Seed local form state once the real config arrives, and again whenever a
  // save succeeds — the mutation writes the response straight into the
  // query cache, so this effect re-fires with the server's own normalized
  // values, not a locally-guessed one.
  useEffect(() => {
    if (!query.isLoading) setDraft(query.mealTimings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.isLoading, query.mealTimings]);

  const dirty = hasChanges(query.mealTimings, draft ?? query.mealTimings);
  const invalid = draft ? FOOD_SLOTS.some((s) => draft[s.key].start >= draft[s.key].end) : false;

  const updateEntry = (key: keyof MealTimings, patch: Partial<MealTimingEntry>) => {
    setDraft((prev) => {
      const base = prev ?? query.mealTimings;
      return { ...base, [key]: { ...base[key], ...patch } };
    });
  };

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to={hostelId ? `/owner/food?hostelId=${encodeURIComponent(hostelId)}` : '/owner/food'}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Meal Timings</h1>
            <p className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">
              Set once, used everywhere — the weekly menu, and your tenants' Food tab
            </p>
          </div>
        </div>
        <HostelSwitcher hostels={session.hostels} selectedId={hostelId ?? null} onSelect={(id) => setSearchParams({ hostelId: id }, { replace: true })} />
      </div>

      {query.isLoading || !draft ? (
        <div className="flex flex-col gap-2.5">
          {FOOD_SLOTS.map((s) => (
            <div key={s.key} className="h-[76px] animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : (
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
                {entry.enabled && rangeInvalid && (
                  <p className="mt-2 text-[11.5px] font-semibold text-destructive">Start time must be before end time.</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {dirty && (
        <button
          type="button"
          disabled={invalid || query.isSaving}
          onClick={() => draft && query.save(draft)}
          className="min-h-[44px] rounded-xl bg-primary py-3.5 text-center font-display text-[13.5px] font-bold text-primary-foreground shadow-[0_8px_20px_rgba(180,106,85,0.32)] disabled:opacity-50"
        >
          {query.isSaving ? 'Saving…' : 'Save Meal Timings'}
        </button>
      )}
    </div>
  );
}
