import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
import type { FoodMenuItemRow } from '../../hooks/useFoodMenuItems';
import type { ScheduleCellTarget } from '../../hooks/useFoodSchedule';

interface ScheduleMealPickerSheetProps {
  target: ScheduleCellTarget | null;
  library: Record<MealSlotKey, FoodMenuItemRow[]>;
  onPick: (menuItemId: string) => void;
  onClose: () => void;
  isSaving: boolean;
}

/** Tap a library item to place it in this day/slot cell of the real weekly schedule. */
export function ScheduleMealPickerSheet({ target, library, onPick, onClose, isSaving }: ScheduleMealPickerSheetProps) {
  if (!target) return null;
  const meta = MEAL_CATEGORY_META[target.slot];
  const items = library[target.slot];

  return (
    <BottomSheet open={!!target} onOpenChange={(v) => !v && onClose()} title={`Choose a ${meta.label.toLowerCase()} item`}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">Tap an item to place it on this day</p>
        {items.length === 0 ? (
          <p className="py-4 text-center text-[12.5px] text-muted-foreground">No {meta.label.toLowerCase()} items in your library yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={isSaving}
                onClick={() => onPick(item.id)}
                className="rounded-full border border-border bg-card px-3.5 py-2 text-[12.5px] font-semibold text-foreground disabled:opacity-50"
              >
                {item.name}
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={onClose} className="pt-2 text-center text-[13px] font-semibold text-muted-foreground">
          Cancel
        </button>
      </div>
    </BottomSheet>
  );
}
