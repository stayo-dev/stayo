import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/app/components/ui/sheet';
import { useIsMobile } from '@/app/components/ui/use-mobile';
import { FOOD_SLOTS, type MealSlotKey } from '@shared/mocks/food';
import type { useFoodMenuItems } from '../../hooks/useFoodMenuItems';
import { filterByName } from '../../timetableDnd';
import { LibraryChip } from './MealPlanChips';

interface FoodLibraryDrawerProps {
  open: boolean;
  onClose: () => void;
  library: ReturnType<typeof useFoodMenuItems>;
  /** Preselects the meal-type tab — set when opened via a specific cell's "+ Add food", so the owner isn't hunting for the right section. */
  initialSlot: MealSlotKey | null;
  onAdd: (itemId: string) => void;
  onDragEnd: (itemId: string, mealType: MealSlotKey, point: { x: number; y: number }) => void;
  /** Fires continuously while a chip is being dragged (`null` on drop) — the meal type is the chip's own (always the drawer's active tab), so the page can flag a cell of a different meal type as an invalid target before the drop happens. */
  onDragMove: (mealType: MealSlotKey, point: { x: number; y: number } | null) => void;
}

/**
 * Food Library, on demand — a right-side panel on desktop, a bottom sheet on
 * mobile (`useIsMobile`, same `Sheet`+`side` pattern `ChangeRequestDrawer`
 * already established), replacing the retired `TimetablePage`'s
 * always-inline-below-the-active-section library panel (ADR-121). Every chip
 * here is draggable onto any Meal Plan cell — resolving *which* cell is the
 * caller's job (`gridDnd.findDropTarget` against whichever cells are
 * currently registered), this component only reports the drop point.
 */
export function FoodLibraryDrawer({ open, onClose, library, initialSlot, onAdd, onDragEnd, onDragMove }: FoodLibraryDrawerProps) {
  const isMobile = useIsMobile();
  const [slot, setSlot] = useState<MealSlotKey>(initialSlot ?? 'breakfast');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open && initialSlot) setSlot(initialSlot);
    if (open) setQuery('');
  }, [open, initialSlot]);

  const items = filterByName(library.library[slot], query);

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} modal={!isMobile ? false : undefined}>
      <SheetContent side={isMobile ? 'bottom' : 'right'} className={isMobile ? 'h-[80dvh] overflow-y-auto rounded-t-2xl' : 'w-full overflow-y-auto sm:max-w-sm'}>
        <SheetHeader>
          <SheetTitle>Food Library</SheetTitle>
          <SheetDescription>Drag or tap a food item onto any meal</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4 pb-6">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {FOOD_SLOTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSlot(s.key)}
                className={`flex min-h-[36px] flex-none items-center rounded-full border px-3 text-[12px] font-bold ${
                  slot === s.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
            <Search className="h-3.5 w-3.5 flex-none text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${FOOD_SLOTS.find((s) => s.key === slot)?.label.toLowerCase()} items`}
              className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-foreground outline-none"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="text-muted-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="py-2 text-center text-[12.5px] text-muted-foreground">No food items found</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {items.map((item) => (
                <LibraryChip
                  key={item.id}
                  name={item.name}
                  onAdd={() => onAdd(item.id)}
                  onDragEnd={(point) => onDragEnd(item.id, slot, point)}
                  onDragMove={(point) => onDragMove(slot, point)}
                />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
