import { FOOD_SLOTS, type MealSlotKey } from '@shared/mocks/food';
import type { MealTimings } from '@features/food/mealTimings';
import { formatTimeRange } from '@features/food/mealTimings';
import type { Rect } from '../../timetableDnd';
import { cellAt, DAY_ORDER, type DayKey, type WeekGrid } from '../../weekGrid';
import { mealIcon } from '../../mealIcons';
import { MealPlanCell } from './MealPlanCell';

const DAY_LABEL_SHORT: Record<DayKey, string> = {
  MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu',
  FRIDAY: 'Fri', SATURDAY: 'Sat', SUNDAY: 'Sun',
};

interface MealPlanGridProps {
  weekGrid: WeekGrid;
  mealTimings: MealTimings;
  liveNameById: Map<string, string>;
  setCellItems: (mealId: string, menuItemIds: string[]) => void;
  onOpenAddFood: (day: DayKey, slot: MealSlotKey) => void;
  onCopyToDays: (day: DayKey, slot: MealSlotKey) => void;
  /** The page-level trash drop zone's current rect — passed through to every cell so a placed chip's drag-end can check it (ADR-123). */
  getTrashRect: () => Rect | null;
  /** A placed chip's live drag position, passed through to every cell — drives the trash zone's visibility/hover highlight at the page level. */
  onChipDragMove: (point: { x: number; y: number } | null) => void;
}

/**
 * Desktop Meal Plan grid (ADR-121, `hidden md:block`) — a real 7×4 matrix,
 * sticky meal-name column. This replaces the retired `TimetablePage`'s
 * one-active-day/one-active-section model entirely on this breakpoint. Used
 * to also register a multi-zone drop resolver so a dragged Food Library chip
 * could land on any cell — retired with the drawer (ADR-123); a cell's own
 * chips now only ever drag to reorder-within-cell or drop-on-trash.
 */
export function MealPlanGrid({ weekGrid, mealTimings, liveNameById, setCellItems, onOpenAddFood, onCopyToDays, getTrashRect, onChipDragMove }: MealPlanGridProps) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <div className="grid min-w-[720px] grid-cols-[120px_repeat(7,1fr)]">
        <div className="sticky left-0 z-10 border-b border-r border-border bg-card p-2" />
        {DAY_ORDER.map((day) => (
          <div key={day} className="border-b border-border p-2 text-center font-display text-[12.5px] font-bold text-foreground">
            {DAY_LABEL_SHORT[day]}
          </div>
        ))}

        {FOOD_SLOTS.map((slotMeta) => {
          const Icon = mealIcon(slotMeta.key);
          const timing = mealTimings[slotMeta.key];
          return (
            <div key={slotMeta.key} className="contents">
              <div className="sticky left-0 z-10 flex flex-col gap-0.5 border-b border-r border-border bg-card p-2">
                <span className="flex items-center gap-1.5">
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md" style={{ background: slotMeta.tint }}>
                    <Icon className="h-3.5 w-3.5" style={{ color: slotMeta.color }} strokeWidth={1.9} />
                  </span>
                  <span className="text-[12px] font-bold text-foreground">{slotMeta.label}</span>
                </span>
                <span className="pl-7.5 text-[10px] text-muted-foreground">{timing.enabled ? formatTimeRange(timing) : 'Off'}</span>
              </div>
              {DAY_ORDER.map((day) => {
                const cell = cellAt(weekGrid, day, slotMeta.key);
                const key = `${day}:${slotMeta.key}`;
                return (
                  <div key={key} className="border-b border-border p-1.5">
                    <MealPlanCell
                      day={day}
                      slot={slotMeta.key}
                      cell={cell}
                      liveNameById={liveNameById}
                      compact
                      getTrashRect={getTrashRect}
                      onChipDragMove={onChipDragMove}
                      onRemove={(itemId) => {
                        if (!cell?.id) return;
                        const ids = cell.items.map((i) => i.menu_item_id).filter((id): id is string => Boolean(id));
                        setCellItems(cell.id, ids.filter((id) => id !== itemId));
                      }}
                      onReorder={(ids) => cell?.id && setCellItems(cell.id, ids)}
                      onOpenAddFood={() => onOpenAddFood(day, slotMeta.key)}
                      onCopyToDays={() => onCopyToDays(day, slotMeta.key)}
                      onClear={() => cell?.id && setCellItems(cell.id, [])}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
