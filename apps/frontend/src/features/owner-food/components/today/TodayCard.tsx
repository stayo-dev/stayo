import { UtensilsCrossed } from 'lucide-react';
import { MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
import { currentAndNextMeal, formatTimeRange, type MealTimings } from '@features/food/mealTimings';
import { mealIcon } from '../../mealIcons';
import { cellAt, dayKeyFor, EMPTY_CELL_LABEL, formatCellItems, isFilled, SLOT_ORDER, type WeekGrid } from '../../weekGrid';

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
 * With no schedule row — only a hostel that has never had a menu, since a
 * month without its own menu now inherits the latest one (backend
 * `month-carry-forward.ts`) — this says so instead of rendering four confident
 * "Not set" rows with Fix buttons that have no cell to open. The remedy is the
 * Meal Plan card below.
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
          <p className="mt-2 text-[12.5px] text-muted-foreground">Build your weekly menu in Meal Plan below — it carries over to every month after.</p>
        </div>
      </div>
    );
  }

  const currentCell = cellAt(grid, day, current);
  const nextCell = next ? cellAt(grid, day, next) : null;
  const rest = SLOT_ORDER.filter((slot) => slot !== current && slot !== next && mealTimings[slot]?.enabled);

  const CurrentIcon = mealIcon(current);
  const NextIcon = next ? mealIcon(next) : null;
  const currentTiming = mealTimings[current];

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{dateLabel}</span>

      {/* The current meal: what is being served, as dishes you can scan — not
          one long string set at display size, which wrapped into a wall of
          giant words once a meal had three or four items. */}
      <div className="rounded-[20px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-primary">
            <CurrentIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
            Now · {MEAL_CATEGORY_META[current].label}
          </span>
          {currentTiming && (
            <span className="flex-none whitespace-nowrap rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
              {formatTimeRange(currentTiming)}
            </span>
          )}
        </div>

        {isFilled(currentCell) ? (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label={`${MEAL_CATEGORY_META[current].label} menu`}>
            {currentCell!.items.map((item) => (
              <li
                key={item.id}
                className="rounded-full border border-border bg-background px-3 py-1.5 text-[14px] font-semibold leading-tight text-foreground"
              >
                {item.item_name}
              </li>
            ))}
          </ul>
        ) : (
          <button
            type="button"
            onClick={() => onFix(current)}
            className="mt-2 flex min-h-[44px] items-center gap-2 text-left font-display text-[20px] font-extrabold leading-tight tracking-tight text-muted-foreground/70"
          >
            {EMPTY_CELL_LABEL}
            <span className="rounded-lg bg-primary px-2.5 py-1 text-[12px] font-bold text-primary-foreground">Fix</span>
          </button>
        )}

        {next && NextIcon && (
          <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-[12.5px]">
            <NextIcon className="h-3.5 w-3.5 flex-none text-muted-foreground" strokeWidth={1.75} />
            <span className="flex-none font-semibold text-muted-foreground">Next · {MEAL_CATEGORY_META[next].label}</span>
            <span className="flex-none whitespace-nowrap text-muted-foreground/70">{formatTimeRange(mealTimings[next])}</span>
            <span
              className={`ml-auto min-w-0 truncate text-right ${isFilled(nextCell) ? 'font-semibold text-foreground' : 'italic text-muted-foreground/60'}`}
              title={formatCellItems(nextCell)}
            >
              {formatCellItems(nextCell)}
            </span>
          </div>
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
              className="flex min-h-[56px] items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5 text-left disabled:cursor-default"
            >
              <Icon className="h-4 w-4 flex-none text-muted-foreground" strokeWidth={1.75} />
              <span className="flex flex-none flex-col">
                <span className="text-[12.5px] font-semibold text-foreground/80">{MEAL_CATEGORY_META[slot].label}</span>
                <span className="whitespace-nowrap text-[11px] text-muted-foreground/70">{formatTimeRange(mealTimings[slot])}</span>
              </span>
              <span
                className={`ml-auto min-w-0 text-right text-[13px] leading-snug ${filled ? 'font-semibold text-foreground' : 'italic text-muted-foreground/60'}`}
              >
                {formatCellItems(cell)}
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
