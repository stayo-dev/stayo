import { useRef } from 'react';
import { Plus } from 'lucide-react';
import type { MealSlotKey } from '@shared/mocks/food';
import { measure } from '../../gridMeasure';
import { moveItem, resolveChipDrop, resolveDisplayName, type Rect } from '../../timetableDnd';
import type { DayKey, WeekGridCell } from '../../weekGrid';
import { MealCellMenu } from './MealCellMenu';
import { PlacedChip } from './MealPlanChips';

interface MealPlanCellProps {
  day: DayKey;
  slot: MealSlotKey;
  cell: WeekGridCell | null;
  liveNameById: Map<string, string>;
  onRemove: (itemId: string) => void;
  onReorder: (ids: string[]) => void;
  onOpenAddFood: () => void;
  onCopyToDays: () => void;
  onClear: () => void;
  /** Compact rendering for the desktop grid's narrower cells — same data, tighter chrome. */
  compact?: boolean;
  /** The page-level trash drop zone's current rect, or `null` before it's mounted/measured — checked before falling through to a reorder (ADR-123). */
  getTrashRect: () => Rect | null;
  /** Reports a placed chip's live drag position (`null` on drop) up to the page, which drives the trash zone's visibility/hover highlight. */
  onChipDragMove: (point: { x: number; y: number } | null) => void;
}

/**
 * One (day, meal-type) cell — the atomic unit of the Meal Plan grid/mobile
 * view (ADR-121). Every cell renders identically regardless of which other
 * cell is "focused" — there is no single active cell any more (contrast the
 * retired `TimetablePage`, one active section at a time). Used to also
 * register its own rect so a Food Library chip drag could resolve which cell
 * it landed on — removed with the drawer (ADR-123); a placed chip's own drag
 * now only ever resolves to reorder-within-cell or drop-on-trash.
 */
export function MealPlanCell({
  day,
  slot,
  cell,
  liveNameById,
  onRemove,
  onReorder,
  onOpenAddFood,
  onCopyToDays,
  onClear,
  compact,
  getTrashRect,
  onChipDragMove,
}: MealPlanCellProps) {
  const items = cell?.items ?? [];
  const chipElsRef = useRef(new Map<number, HTMLElement>());

  const registerChip = (index: number, el: HTMLElement | null) => {
    if (el) chipElsRef.current.set(index, el);
    else chipElsRef.current.delete(index);
  };

  const handleReorderEnd = (fromIndex: number, point: { x: number; y: number }) => {
    const rects: ReturnType<typeof measure>[] = [];
    chipElsRef.current.forEach((el, i) => {
      rects[i] = measure(el);
    });
    const resolution = resolveChipDrop(point, getTrashRect(), rects, fromIndex);
    if (resolution.kind === 'trash') {
      const itemId = items[fromIndex]?.menu_item_id;
      if (itemId) onRemove(itemId);
      return;
    }
    const currentIds = items.map((i) => i.menu_item_id).filter((id): id is string => Boolean(id));
    onReorder(moveItem(currentIds, fromIndex, resolution.toIndex));
  };

  return (
    <div
      data-cell={`${day}:${slot}`}
      className={`flex min-h-[56px] flex-col gap-1 rounded-xl border border-border bg-background transition-colors ${compact ? 'p-1.5' : 'p-2'}`}
    >
      <div className="flex flex-wrap items-start gap-1">
        {items.length === 0 ? (
          <span className="py-1 text-[11px] italic text-muted-foreground/60">No food added</span>
        ) : (
          items.map((item, index) => (
            <PlacedChip
              key={item.id}
              name={resolveDisplayName(item, liveNameById)}
              index={index}
              registerEl={registerChip}
              onRemove={() => item.menu_item_id && onRemove(item.menu_item_id)}
              onDragEnd={handleReorderEnd}
              onDragMove={onChipDragMove}
            />
          ))
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
