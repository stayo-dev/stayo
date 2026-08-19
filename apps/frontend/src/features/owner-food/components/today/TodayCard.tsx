import { UtensilsCrossed } from 'lucide-react';
import { MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
import { currentAndNextMeal, formatTimeRange, type MealTimings } from '@features/food/mealTimings';
import { mealIcon } from '../../mealIcons';
import { cellAt, dayKeyFor, EMPTY_CELL_LABEL, isFilled, SLOT_ORDER, type WeekGrid } from '../../weekGrid';

interface TodayCardProps {
  grid: WeekGrid;
  isLoading: boolean;
  /** False when this hostel has no `food_schedules` row for the month at all. */
  hasSchedule: boolean;
  onFix: (slot: MealSlotKey) => void;
  mealTimings: MealTimings;
}

/**
 * The answer to the question this tab exists for: what are we serving right now?
 *
 * The current meal is the hero and the next is its subtitle, because meals have
 * a time — at 7:40am the owner is asking about breakfast, not about a grid of
 * four equal cards they have to scan.
 *
 * With no schedule row — a new hostel, or the 1st before the carry-forward cron
 * runs — this says so instead of rendering four confident "Not set" rows with
 * Fix buttons that have no cell to open. The remedy for a whole missing month
 * is Generate, which the grid below already owns.
 */
export function TodayCard({ grid, isLoading, hasSchedule, onFix, mealTimings }: TodayCardProps) {
  const now = new Date();
  const day = dayKeyFor(now);
  const { current, next } = currentAndNextMeal(mealTimings, now);

  const dateLabel = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{dateLabel}</span>
        <div className="h-[124px] animate-pulse rounded-[20px] bg-muted" />
        <div className="h-[92px] animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (!hasSchedule) {
    return (
      <div className="flex flex-col gap-3">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{dateLabel}</span>
        <div className="rounded-[20px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            <UtensilsCrossed className="h-3.5 w-3.5" strokeWidth={1.75} />
            No menu yet
          </span>
          <span className="mt-1 block font-display text-[24px] font-extrabold leading-tight tracking-tight text-muted-foreground/70">
            Nothing planned for {now.toLocaleDateString('en-IN', { month: 'long' })}
          </span>
          <p className="mt-2 text-[12.5px] text-muted-foreground">Generate this month's schedule below and today fills itself in.</p>
        </div>
      </div>
    );
  }

  const currentCell = cellAt(grid, day, current);
  const nextCell = next ? cellAt(grid, day, next) : null;
  const rest = SLOT_ORDER.filter((slot) => slot !== current && slot !== next && mealTimings[slot]?.enabled);

  const CurrentIcon = mealIcon(current);

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{dateLabel}</span>

      <div className="rounded-[20px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          <CurrentIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
          Now · {MEAL_CATEGORY_META[current].label}
        </span>

        {isFilled(currentCell) ? (
          <span className="mt-1 block font-display text-[30px] font-extrabold leading-tight tracking-tight text-foreground">
            {currentCell!.item_name}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onFix(current)}
            className="mt-1 flex min-h-[44px] items-center gap-2 text-left font-display text-[24px] font-extrabold leading-tight tracking-tight text-muted-foreground/70"
          >
            {EMPTY_CELL_LABEL}
            <span className="rounded-lg bg-primary px-2.5 py-1 text-[12px] font-bold text-primary-foreground">Fix</span>
          </button>
        )}

        {next && (
          <span className="mt-2 block text-[12.5px] text-muted-foreground">
            Next · {MEAL_CATEGORY_META[next].label} {formatTimeRange(mealTimings[next])} —{' '}
            <span className={isFilled(nextCell) ? 'font-semibold text-foreground' : 'italic'}>
              {isFilled(nextCell) ? nextCell!.item_name : EMPTY_CELL_LABEL}
            </span>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {rest.map((slot) => {
          const cell = cellAt(grid, day, slot);
          const Icon = mealIcon(slot);
          const filled = isFilled(cell);
          return (
            <button
              key={slot}
              type="button"
              onClick={() => !filled && onFix(slot)}
              disabled={filled}
              className="flex min-h-[44px] items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-left disabled:cursor-default"
            >
              <Icon className="h-4 w-4 flex-none text-muted-foreground" strokeWidth={1.75} />
              <span className="w-[68px] flex-none text-[11.5px] font-semibold text-muted-foreground">
                {MEAL_CATEGORY_META[slot].label}
              </span>
              <span className="text-[11px] text-muted-foreground/70">{formatTimeRange(mealTimings[slot])}</span>
              <span className={`ml-auto text-[13px] ${filled ? 'font-semibold text-foreground' : 'italic text-muted-foreground/60'}`}>
                {filled ? cell!.item_name : EMPTY_CELL_LABEL}
              </span>
              {!filled && (
                <span className="flex-none rounded-lg bg-secondary px-2 py-1 text-[11px] font-bold text-primary">Fix</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
