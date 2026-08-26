import { useEffect, useRef } from 'react';
import { FOOD_SLOTS, type MealSlotKey } from '@shared/mocks/food';
import type { MealTimings } from '@features/food/mealTimings';
import { formatTimeRange } from '@features/food/mealTimings';
import { findDropTarget, type GridCellRect } from '../../gridDnd';
import { measure } from '../../gridMeasure';
import { cellAt, dayCompleteness, DAY_ORDER, type DayKey, type WeekGrid } from '../../weekGrid';
import { mealIcon } from '../../mealIcons';
import { MealPlanCell } from './MealPlanCell';
import type { DropResolution } from './dropResolution';

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
  registerDropResolver: (resolve: (point: { x: number; y: number }) => DropResolution | null) => void;
  /** Which cell is currently under an in-progress drag, and whether dropping there is valid (meal type matches) — drives the highlight. `null` when nothing is being dragged. */
  dragHover: { day: DayKey; slot: MealSlotKey; valid: boolean } | null;
}

/**
 * Mobile Meal Plan view (ADR-121, `md:hidden`) — day tabs plus the selected
 * day's 4 meal sections, every one of them a live drop target and carrying
 * its own persistent "+ Add food", not just one "active" section (contrast
 * the retired `TimetablePage`, which gated the library/add affordance behind
 * tapping a section header first).
 */
export function MealPlanMobile({ activeDay, onSelectDay, weekGrid, mealTimings, liveNameById, setCellItems, onOpenAddFood, onCopyToDays, registerDropResolver, dragHover }: MealPlanMobileProps) {
  const cellElsRef = useRef(new Map<string, HTMLDivElement>());

  // Only the visible day's cells are ever registered — a drop can't land on
  // a day that isn't rendered, which is correct: mobile shows one day at a
  // time, so there is nothing else to drop onto.
  useEffect(() => {
    registerDropResolver((point) => {
      const cells: GridCellRect[] = [];
      cellElsRef.current.forEach((el, slot) => {
        cells.push({ day: activeDay, slot: slot as MealSlotKey, rect: measure(el) });
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
          const isHovered = dragHover?.day === activeDay && dragHover?.slot === slotMeta.key;
          const dropState = isHovered ? (dragHover!.valid ? 'valid' : 'invalid') : undefined;
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
                  dropState={dropState}
                  registerRect={(el) => {
                    if (el) cellElsRef.current.set(slotMeta.key, el);
                    else cellElsRef.current.delete(slotMeta.key);
                  }}
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
