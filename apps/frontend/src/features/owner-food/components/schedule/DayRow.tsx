import { MEAL_CATEGORY_META } from '@shared/mocks/food';
import { mealIcon } from '../../mealIcons';
import { cellAt, isFilled, SLOT_ORDER, type DayKey, type WeekGrid, type WeekGridCell } from '../../weekGrid';

const DAY_LABEL: Record<DayKey, string> = {
  MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu',
  FRIDAY: 'Fri', SATURDAY: 'Sat', SUNDAY: 'Sun',
};

interface DayRowProps {
  day: DayKey;
  grid: WeekGrid;
  isToday: boolean;
  onPick: (cell: WeekGridCell) => void;
}

/**
 * One day of the week as a single row of four meal chips.
 *
 * Replaces a 2x2 card block per day — 28 cards over roughly seven screens of
 * scrolling — with the shape `MonthHistoryList` already uses for a published
 * month. The whole week now fits in about one screen, which is what makes
 * dragging a chip to another day practical on a phone at all.
 */
export function DayRow({ day, grid, isToday, onPick }: DayRowProps) {
  return (
    <div className={`flex items-start gap-2 rounded-xl px-1.5 py-1.5 ${isToday ? 'bg-secondary/40' : ''}`}>
      <span className={`w-9 flex-none pt-2.5 text-[11px] font-bold uppercase tracking-wide ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
        {DAY_LABEL[day]}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {SLOT_ORDER.map((slot) => {
          const cell = cellAt(grid, day, slot);
          // `isFilled` is a plain boolean, not a type predicate — pairing it with
          // `cell` here keeps the item name reachable without a `!` assertion.
          const itemName = cell && isFilled(cell) ? cell.item_name : null;
          const Icon = mealIcon(slot);
          return (
            <button
              key={slot}
              type="button"
              disabled={!cell}
              onClick={() => cell && onPick(cell)}
              aria-label={`${MEAL_CATEGORY_META[slot].label} on ${DAY_LABEL[day]}: ${itemName ?? 'not set'}`}
              className={`flex min-h-[44px] min-w-0 flex-1 basis-[calc(50%-0.375rem)] items-center gap-1.5 rounded-xl border px-2.5 py-2 text-left disabled:opacity-50 ${
                itemName ? 'border-border bg-card' : 'border-dashed border-border bg-transparent'
              }`}
            >
              <Icon className="h-3.5 w-3.5 flex-none text-muted-foreground" strokeWidth={1.75} />
              <span className={`truncate text-[12px] ${itemName ? 'font-semibold text-foreground' : 'italic text-muted-foreground/60'}`}>
                {itemName ?? MEAL_CATEGORY_META[slot].label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
