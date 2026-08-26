import { useRef } from 'react';
import { Plus } from 'lucide-react';
import type { MealSlotKey } from '@shared/mocks/food';
import { measure } from '../../gridMeasure';
import { moveItem, reorderIndexAt, resolveDisplayName } from '../../timetableDnd';
import type { DayKey, WeekGridCell } from '../../weekGrid';
import { MealCellMenu } from './MealCellMenu';
import { PlacedChip } from './MealPlanChips';

interface MealPlanCellProps {
  day: DayKey;
  slot: MealSlotKey;
  cell: WeekGridCell | null;
  liveNameById: Map<string, string>;
  registerRect: (el: HTMLDivElement | null) => void;
  onRemove: (itemId: string) => void;
  onReorder: (ids: string[]) => void;
  onOpenAddFood: () => void;
  onCopyToDays: () => void;
  onClear: () => void;
  /** Compact rendering for the desktop grid's narrower cells — same data, tighter chrome. */
  compact?: boolean;
  /** Set only while a Food Library chip is being dragged over this specific cell — `'valid'` (same meal type) or `'invalid'` (meal-type mismatch, the drop will be refused client-side). `undefined` the rest of the time. */
  dropState?: 'valid' | 'invalid';
}

/**
 * One (day, meal-type) cell — the atomic unit of the Meal Plan grid/mobile
 * view (ADR-121). Every cell renders identically regardless of which other
 * cell is "focused" — there is no single active cell any more (contrast the
 * retired `TimetablePage`, one active section at a time). Registers its own
 * rect via `registerRect` so the page-level drag handler can resolve which
 * cell a dropped Food Library chip landed on (`gridDnd.findDropTarget`).
 */
export function MealPlanCell({ day, slot, cell, liveNameById, registerRect, onRemove, onReorder, onOpenAddFood, onCopyToDays, onClear, compact, dropState }: MealPlanCellProps) {
  const items = cell?.items ?? [];
  const chipElsRef = useRef(new Map<number, HTMLElement>());

  const registerChip = (index: number, el: HTMLElement | null) => {
    if (el) chipElsRef.current.set(index, el);
    else chipElsRef.current.delete(index);
  };

  const handleReorderEnd = (fromIndex: number, point: { x: number; y: number }) => {
    const rects = [] as ReturnType<typeof measure>[];
    chipElsRef.current.forEach((el, i) => {
      rects[i] = measure(el);
    });
    const currentIds = items.map((i) => i.menu_item_id).filter((id): id is string => Boolean(id));
    const toIndex = reorderIndexAt(point, rects, fromIndex);
    onReorder(moveItem(currentIds, fromIndex, toIndex));
  };

  const dropBorderClass =
    dropState === 'valid'
      ? 'border-2 border-success bg-success/10'
      : dropState === 'invalid'
        ? 'border-2 border-destructive bg-destructive/10'
        : 'border border-border bg-background';

  return (
    <div
      ref={registerRect}
      data-cell={`${day}:${slot}`}
      data-drop-state={dropState}
      className={`flex min-h-[56px] flex-col gap-1 rounded-xl transition-colors ${dropBorderClass} ${compact ? 'p-1.5' : 'p-2'}`}
    >
      <div className="flex flex-wrap items-start gap-1">
        {items.length === 0 ? (
          <span className={`py-1 text-[11px] ${dropState ? 'font-semibold' : 'italic text-muted-foreground/60'} ${dropState === 'valid' ? 'text-success' : dropState === 'invalid' ? 'text-destructive' : ''}`}>
            {dropState === 'valid' ? 'Drop here' : dropState === 'invalid' ? 'Wrong meal type' : 'No food added'}
          </span>
        ) : (
          items.map((item, index) => (
            <PlacedChip
              key={item.id}
              name={resolveDisplayName(item, liveNameById)}
              index={index}
              registerEl={registerChip}
              onRemove={() => item.menu_item_id && onRemove(item.menu_item_id)}
              onDragEnd={handleReorderEnd}
            />
          ))
        )}
        {items.length > 0 && dropState && (
          <span className={`py-1 text-[11px] font-semibold ${dropState === 'valid' ? 'text-success' : 'text-destructive'}`}>
            {dropState === 'valid' ? 'Drop here' : 'Wrong meal type'}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={onOpenAddFood}
          className="flex min-h-[28px] items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
        >
          <Plus className="h-3 w-3" /> Add food
        </button>
        <MealCellMenu disabled={items.length === 0} onCopyToDays={onCopyToDays} onClear={onClear} />
      </div>
    </div>
  );
}
