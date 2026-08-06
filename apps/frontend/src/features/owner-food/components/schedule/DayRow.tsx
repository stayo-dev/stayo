import { GripVertical } from 'lucide-react';
import { motion, useDragControls } from 'motion/react';
import { MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
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
  /** Called with `null` on unmount so the parent's rect registry can't go stale. */
  registerChip: (mealId: string, mealType: string, el: HTMLElement | null) => void;
  /** The parent re-measures every chip here — the page may have scrolled since mount. */
  onChipDragStart: () => void;
  /** Where the finger lifted. The parent, not the row, decides what that means. */
  onChipDragEnd: (mealId: string, mealType: string, point: { x: number; y: number }) => void;
  dragDisabled: boolean;
}

interface MealChipProps {
  dayLabel: string;
  slot: MealSlotKey;
  cell: WeekGridCell | null;
  dragDisabled: boolean;
  onPick: (cell: WeekGridCell) => void;
  registerChip: DayRowProps['registerChip'];
  onChipDragStart: DayRowProps['onChipDragStart'];
  onChipDragEnd: DayRowProps['onChipDragEnd'];
}

/**
 * One meal cell. Its own component because `useDragControls` is a hook and so
 * can't be called inside the slot `.map` — the same reason `PropertyList`
 * splits out `PropertyCard`.
 */
function MealChip({ dayLabel, slot, cell, dragDisabled, onPick, registerChip, onChipDragStart, onChipDragEnd }: MealChipProps) {
  const controls = useDragControls();
  // `isFilled` is a plain boolean, not a type predicate — pairing it with
  // `cell` here keeps the item name reachable without a `!` assertion.
  const itemName = cell && isFilled(cell) ? cell.item_name : null;
  const mealId = cell?.id ?? null;
  const Icon = mealIcon(slot);
  // An empty slot has nothing to move, and a cell with no row id has nothing
  // the swap endpoint could address.
  const draggable = Boolean(itemName && mealId) && !dragDisabled;

  return (
    <motion.div
      ref={(el) => {
        if (mealId) registerChip(mealId, slot, el);
      }}
      drag={draggable}
      // Handle-only drag: `dragListener={false}` plus `useDragControls` is the
      // combination `PropertyList` established (ADR-042). It is what keeps the
      // page scrollable and the chip tappable everywhere except the grip.
      dragListener={false}
      dragControls={controls}
      // The grid is authoritative and re-renders from the server response, so
      // the chip must not keep a stray offset after release.
      dragSnapToOrigin
      // Above the shell's `fixed` bottom nav (`z-40`) — a chip dragged low
      // used to vanish behind it, at exactly the moment placement matters.
      whileDrag={{ scale: 1.06, zIndex: 50, boxShadow: '0 12px 28px rgba(0,0,0,0.18)' }}
      onDragStart={onChipDragStart}
      onDragEnd={(_, info) => {
        if (mealId) onChipDragEnd(mealId, slot, info.point);
      }}
      className="flex min-w-0 flex-1 basis-[calc(50%-0.375rem)]"
    >
      <button
        type="button"
        disabled={!cell}
        onClick={() => cell && onPick(cell)}
        aria-label={`${MEAL_CATEGORY_META[slot].label} on ${dayLabel}: ${itemName ?? 'not set'}`}
        className={`flex min-h-[44px] w-full min-w-0 items-center gap-1.5 rounded-xl border px-2.5 py-2 text-left disabled:opacity-50 ${
          itemName ? 'border-border bg-card' : 'border-dashed border-border bg-transparent'
        }`}
      >
        {draggable && (
          <span
            onPointerDown={(e) => {
              e.stopPropagation();
              controls.start(e);
            }}
            // The grip sits inside a button that opens the picker; without this
            // a tap on it would open the picker too. Same reason `DragHandle`
            // stops the click for the Property cards.
            onClick={(e) => e.stopPropagation()}
            aria-label={`Move ${itemName}`}
            className="flex h-11 w-6 flex-none cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        )}
        <Icon className="h-3.5 w-3.5 flex-none text-muted-foreground" strokeWidth={1.75} />
        <span className={`truncate text-[12px] ${itemName ? 'font-semibold text-foreground' : 'italic text-muted-foreground/60'}`}>
          {itemName ?? MEAL_CATEGORY_META[slot].label}
        </span>
      </button>
    </motion.div>
  );
}

/**
 * One day of the week as a single row of four meal chips.
 *
 * Replaces a 2x2 card block per day — 28 cards over roughly seven screens of
 * scrolling — with the shape `MonthHistoryList` already uses for a published
 * month. The whole week now fits in about one screen, which is what makes
 * dragging a chip to another day practical on a phone at all.
 */
export function DayRow({ day, grid, isToday, onPick, registerChip, onChipDragStart, onChipDragEnd, dragDisabled }: DayRowProps) {
  return (
    <div className={`flex items-start gap-2 rounded-xl px-1.5 py-1.5 ${isToday ? 'bg-secondary/40' : ''}`}>
      <span className={`w-9 flex-none pt-2.5 text-[11px] font-bold uppercase tracking-wide ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
        {DAY_LABEL[day]}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {SLOT_ORDER.map((slot) => (
          <MealChip
            key={slot}
            dayLabel={DAY_LABEL[day]}
            slot={slot}
            cell={cellAt(grid, day, slot)}
            dragDisabled={dragDisabled}
            onPick={onPick}
            registerChip={registerChip}
            onChipDragStart={onChipDragStart}
            onChipDragEnd={onChipDragEnd}
          />
        ))}
      </div>
    </div>
  );
}
