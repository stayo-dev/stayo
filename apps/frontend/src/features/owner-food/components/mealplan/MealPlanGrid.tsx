import { useEffect, useRef } from 'react';
import { FOOD_SLOTS, type MealSlotKey } from '@shared/mocks/food';
import type { MealTimings } from '@features/food/mealTimings';
import { formatTimeRange } from '@features/food/mealTimings';
import { findDropTarget, type GridCellRect } from '../../gridDnd';
import { measure } from '../../gridMeasure';
import { cellAt, DAY_ORDER, type DayKey, type WeekGrid } from '../../weekGrid';
import { mealIcon } from '../../mealIcons';
import { MealPlanCell } from './MealPlanCell';
import type { DropResolution } from './dropResolution';

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
  /**
   * The page owns the drag source (the Food Library drawer chip) and the
   * actual add/duplicate/toast logic; this component only knows its own
   * cells' geometry. Registers a pure "what cell (if any) is at this point"
   * resolver so the page can ask it on drop, without this component needing
   * to know what a "drop" even means.
   */
  registerDropResolver: (resolve: (point: { x: number; y: number }) => DropResolution | null) => void;
  /** Which cell is currently under an in-progress drag, and whether dropping there is valid (meal type matches) — drives the highlight. `null` when nothing is being dragged. */
  dragHover: { day: DayKey; slot: MealSlotKey; valid: boolean } | null;
}

/**
 * Desktop Meal Plan grid (ADR-121, `hidden md:block`) — a real 7×4 matrix,
 * sticky meal-name column, every cell simultaneously a live drop zone. This
 * replaces the retired `TimetablePage`'s one-active-day/one-active-section
 * model entirely on this breakpoint.
 */
export function MealPlanGrid({ weekGrid, mealTimings, liveNameById, setCellItems, onOpenAddFood, onCopyToDays, registerDropResolver, dragHover }: MealPlanGridProps) {
  const cellElsRef = useRef(new Map<string, HTMLDivElement>());

  // Re-registered on every render (weekGrid changes constantly as edits land)
  // so the resolver always closes over the current grid, not a stale one.
  useEffect(() => {
    registerDropResolver((point) => {
      const cells: GridCellRect[] = [];
      cellElsRef.current.forEach((el, key) => {
        const [day, slot] = key.split(':') as [DayKey, MealSlotKey];
        cells.push({ day, slot, rect: measure(el) });
      });
      const target = findDropTarget(point, cells);
      if (!target) return null;
      const cell = cellAt(weekGrid, target.day, target.slot);
      if (!cell?.id) return null;
      return {
        cellId: cell.id,
        currentIds: cell.items.map((i) => i.menu_item_id).filter((id): id is string => Boolean(id)),
        day: target.day,
        slot: target.slot,
      };
    });
  });

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
                const isHovered = dragHover?.day === day && dragHover?.slot === slotMeta.key;
                const dropState = isHovered ? (dragHover!.valid ? 'valid' : 'invalid') : undefined;
                return (
                  <div key={key} className="border-b border-border p-1.5">
                    <MealPlanCell
                      day={day}
                      slot={slotMeta.key}
                      cell={cell}
                      liveNameById={liveNameById}
                      compact
                      dropState={dropState}
                      registerRect={(el) => {
                        if (el) cellElsRef.current.set(key, el);
                        else cellElsRef.current.delete(key);
                      }}
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
