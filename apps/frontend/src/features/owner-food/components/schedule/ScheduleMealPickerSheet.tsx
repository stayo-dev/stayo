import { useEffect, useState } from 'react';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
import type { FoodMenuItemRow } from '../../hooks/useFoodMenuItems';
import type { ScheduleCellTarget } from '../../hooks/useFoodSchedule';

/** One of the other six days this meal could trade places with. */
export interface MealMoveTarget {
  mealId: string;
  dayLabel: string;
  itemName: string;
}

interface ScheduleMealPickerSheetProps {
  target: ScheduleCellTarget | null;
  library: Record<MealSlotKey, FoodMenuItemRow[]>;
  onPick: (menuItemId: string) => void;
  onAddItem: (slot: MealSlotKey, name: string) => Promise<string | null>;
  onClose: () => void;
  isSaving: boolean;
  /** Empty when the cell has nothing to move, or when no other day holds this meal type. */
  moveTargets: MealMoveTarget[];
  onMove: (targetMealId: string) => void;
  isMoving: boolean;
}

/**
 * Tap a library item to place it in this day/slot cell.
 *
 * The add-item field is here because it has to be: when a meal type has no
 * items, this sheet used to dead-end at "No items in your library yet", and
 * filling one blank cost seven interactions — dismiss, scroll, expand the right
 * accordion, add, confirm, scroll back, re-tap the cell.
 */
export function ScheduleMealPickerSheet({ target, library, onPick, onAddItem, onClose, isSaving, moveTargets, onMove, isMoving }: ScheduleMealPickerSheetProps) {
  const [newName, setNewName] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    setNewName('');
    setIsAdding(false);
  }, [target?.mealId]);

  if (!target) return null;
  const meta = MEAL_CATEGORY_META[target.slot];
  const items = library[target.slot];

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name || isAdding) return;
    setIsAdding(true);
    const id = await onAddItem(target.slot, name);
    setIsAdding(false);
    // Only clear on success. A rejected name (duplicate, network) is the one
    // the owner most needs back in the field to correct — `onAddItem` has
    // already said why it failed.
    if (id) {
      setNewName('');
      onPick(id);
    }
  };

  return (
    <BottomSheet open={!!target} onOpenChange={(v) => !v && onClose()} title={`Choose a ${meta.label.toLowerCase()} item`}>
      <div className="flex flex-col gap-3">
        {items.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            No {meta.label.toLowerCase()} items yet — add one below and it goes straight onto this day.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Tap an item to place it on this day</p>
            <div className="flex flex-wrap gap-2">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={isSaving}
                  onClick={() => onPick(item.id)}
                  className="min-h-[44px] rounded-full border border-border bg-card px-3.5 py-2 text-[12.5px] font-semibold text-foreground disabled:opacity-50"
                >
                  {item.name}
                </button>
              ))}
            </div>
          </>
        )}

        {moveTargets.length > 0 && (
          // The same swap the grip performs. It is here because a drag reaches
          // only the days that happen to be on screen together, and reaches
          // nothing at all without a pointer.
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">Move to another day — the two days trade meals</p>
            <div className="flex flex-wrap gap-2">
              {moveTargets.map((moveTarget) => (
                <button
                  key={moveTarget.mealId}
                  type="button"
                  disabled={isSaving || isMoving}
                  onClick={() => onMove(moveTarget.mealId)}
                  aria-label={`Swap with ${moveTarget.dayLabel} (${moveTarget.itemName})`}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-[12.5px] font-semibold text-foreground disabled:opacity-50"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5 flex-none text-muted-foreground" strokeWidth={1.75} />
                  {moveTarget.dayLabel}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 rounded-xl border-[1.4px] border-dashed border-border bg-card py-1.5 pl-3.5 pr-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder={`New ${meta.label.toLowerCase()} item`}
            className="min-w-0 flex-1 border-none bg-transparent text-[13px] font-semibold text-foreground outline-none"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newName.trim() || isAdding}
            className="flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
            aria-label="Add item and place it on this day"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <button type="button" onClick={onClose} className="min-h-[44px] pt-1 text-center text-[13px] font-semibold text-muted-foreground">
          Cancel
        </button>
      </div>
    </BottomSheet>
  );
}
