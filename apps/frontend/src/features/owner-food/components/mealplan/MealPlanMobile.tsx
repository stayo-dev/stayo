import { FOOD_SLOTS, type MealSlotKey } from '@shared/mocks/food';
import type { MealTimings } from '@features/food/mealTimings';
import { formatTimeRange } from '@features/food/mealTimings';
import type { Rect } from '../../timetableDnd';
import { cellAt, dayCompleteness, DAY_ORDER, type DayKey, type WeekGrid } from '../../weekGrid';
import { mealIcon } from '../../mealIcons';
import { MealPlanCell } from './MealPlanCell';

const DAY_LABEL_SHORT: Record<DayKey, string> = {
  MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu',
  FRIDAY: 'Fri', SATURDAY: 'Sat', SUNDAY: 'Sun',
};

interface MealPlanMobileProps {
  activeDay: DayKey;
  onSelectDay: (day: DayKey) => void;
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
 * Mobile Meal Plan view (ADR-121, `md:hidden`) — day tabs plus the selected
 * day's 4 meal sections, every one of them carrying its own persistent
 * "+ Add food", not just one "active" section (contrast the retired
 * `TimetablePage`, which gated the library/add affordance behind tapping a
 * section header first). Used to also register a multi-zone drop resolver so
 * a dragged Food Library chip could land on any visible cell — retired with
 * the drawer (ADR-123); a cell's own chips now only ever drag to
 * reorder-within-cell or drop-on-trash.
 */
export function MealPlanMobile({ activeDay, onSelectDay, weekGrid, mealTimings, liveNameById, setCellItems, onOpenAddFood, onCopyToDays, getTrashRect, onChipDragMove }: MealPlanMobileProps) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {DAY_ORDER.map((day) => {
          const completeness = dayCompleteness(weekGrid, day);
          const active = day === activeDay;
          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelectDay(day)}
              className={`flex min-h-[40px] flex-none items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-bold ${
                active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground'
              }`}
            >
              {DAY_LABEL_SHORT[day]}
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  completeness === 'COMPLETE'
                    ? active ? 'bg-primary-foreground' : 'bg-success'
                    : completeness === 'PARTIAL'
                      ? active ? 'bg-primary-foreground/60' : 'bg-warning'
                      : active ? 'bg-primary-foreground/30' : 'bg-border'
                }`}
              />
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2.5">
        {FOOD_SLOTS.map((slotMeta) => {
          const cell = cellAt(weekGrid, activeDay, slotMeta.key);
          const Icon = mealIcon(slotMeta.key);
          const timing = mealTimings[slotMeta.key];
          return (
            <div key={slotMeta.key} className="overflow-hidden rounded-[18px] border border-border bg-card">
              <div className="flex items-center gap-2.5 px-3.5 py-3">
                <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[11px]" style={{ background: slotMeta.tint }}>
                  <Icon className="h-4 w-4" style={{ color: slotMeta.color }} strokeWidth={1.75} />
                </span>
                <span className="flex-1">
                  <span className="block font-display text-sm font-bold tracking-tight text-foreground">{slotMeta.label}</span>
                  <span className="block text-[10.5px] text-muted-foreground">{timing.enabled ? formatTimeRange(timing) : 'Off'}</span>
                </span>
              </div>
              <div className="px-3.5 pb-3.5 pt-0.5">
                <MealPlanCell
                  day={activeDay}
                  slot={slotMeta.key}
                  cell={cell}
                  liveNameById={liveNameById}
                  getTrashRect={getTrashRect}
                  onChipDragMove={onChipDragMove}
                  onRemove={(itemId) => {
                    if (!cell?.id) return;
                    const ids = cell.items.map((i) => i.menu_item_id).filter((id): id is string => Boolean(id));
                    setCellItems(cell.id, ids.filter((id) => id !== itemId));
                  }}
                  onReorder={(ids) => cell?.id && setCellItems(cell.id, ids)}
                  onOpenAddFood={() => onOpenAddFood(activeDay, slotMeta.key)}
                  onCopyToDays={() => onCopyToDays(activeDay, slotMeta.key)}
                  onClear={() => cell?.id && setCellItems(cell.id, [])}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
