import { ChevronDown, ChevronUp, History } from 'lucide-react';
import { MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
import { DAY_ORDER, type DayKey } from '../../hooks/useFoodSchedule';
import type { useFoodScheduleHistory } from '../../hooks/useFoodScheduleHistory';

const DAY_LABEL: Record<DayKey, string> = {
  MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu', FRIDAY: 'Fri', SATURDAY: 'Sat', SUNDAY: 'Sun',
};
const SLOT_ORDER: MealSlotKey[] = ['breakfast', 'lunch', 'snacks', 'dinner'];

interface MonthHistoryListProps {
  history: ReturnType<typeof useFoodScheduleHistory>;
}

/** Past published months, read-only — tap a month to expand its full week. */
export function MonthHistoryList({ history }: MonthHistoryListProps) {
  if (history.isLoading) return <div className="h-16 animate-pulse rounded-2xl bg-muted" />;
  if (history.months.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <History className="h-3.5 w-3.5" /> Month History
      </span>
      <div className="flex flex-col gap-2">
        {history.months.map((m) => {
          const monthLabel = new Date(m.month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
          const expanded = history.openMonth === m.month;
          return (
            <div key={m.id} className="overflow-hidden rounded-[16px] border border-border bg-card">
              <button type="button" onClick={() => history.toggleMonth(m.month)} className="flex w-full items-center gap-2.5 px-3.5 py-3">
                <span className="flex-1 text-left font-display text-[13px] font-bold text-foreground">{monthLabel}</span>
                <span className="rounded-full bg-success/15 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-success">Published</span>
                {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>
              {expanded && (
                <div className="flex flex-col gap-2 border-t border-border p-3">
                  {history.isLoadingDetail || !history.detail ? (
                    <div className="h-24 animate-pulse rounded-xl bg-muted" />
                  ) : (
                    DAY_ORDER.map((day) => {
                      const cells = history.detail!.food_schedule_meals.filter((c) => c.day_of_week === day);
                      return (
                        <div key={day} className="flex items-start gap-2 text-[11.5px]">
                          <span className="w-8 flex-none font-bold text-muted-foreground">{DAY_LABEL[day as DayKey]}</span>
                          <span className="flex-1 text-foreground">
                            {SLOT_ORDER.map((slot) => {
                              const cell = cells.find((c) => c.meal_type.toLowerCase() === slot);
                              return `${MEAL_CATEGORY_META[slot].emoji} ${cell?.item_name ?? '—'}`;
                            }).join('   ')}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
