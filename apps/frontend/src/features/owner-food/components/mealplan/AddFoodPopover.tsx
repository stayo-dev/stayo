import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/app/components/ui/sheet';
import { useIsMobile } from '@/app/components/ui/use-mobile';
import { FOOD_SLOTS, type MealSlotKey } from '@shared/mocks/food';
import type { useFoodMenuItems } from '../../hooks/useFoodMenuItems';
import { filterByName } from '../../timetableDnd';
import type { DayKey } from '../../weekGrid';

const DAY_LABEL: Record<DayKey, string> = {
  MONDAY: 'Monday', TUESDAY: 'Tuesday', WEDNESDAY: 'Wednesday', THURSDAY: 'Thursday',
  FRIDAY: 'Friday', SATURDAY: 'Saturday', SUNDAY: 'Sunday',
};

interface AddFoodPopoverProps {
  open: boolean;
  onClose: () => void;
  /** The specific cell "+ Add food" was tapped for — `null` closes/hides the popover. No meal-type tab bar: the slot is already implied by which cell opened this (ADR-123). */
  target: { day: DayKey; slot: MealSlotKey } | null;
  library: ReturnType<typeof useFoodMenuItems>;
  onPickExisting: (itemId: string) => void;
  onCreateNew: (name: string) => void | Promise<void>;
}

/**
 * Replaces `FoodLibraryDrawer.tsx` (ADR-123) — free-text search-and-add
 * scoped to exactly the cell whose "+ Add food" was tapped. Reuses the same
 * `Sheet`/`useIsMobile` bottom-vs-right pattern the drawer established,
 * simplified to one slot's items with no tab bar and no drag affordance —
 * items are added by tap only, dishes already never require dragging to
 * place, only to remove (`TrashDropZone`).
 */
export function AddFoodPopover({ open, onClose, target, library, onPickExisting, onCreateNew }: AddFoodPopoverProps) {
  const isMobile = useIsMobile();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCreating(false);
    }
  }, [open, target]);

  if (!target) return null;

  const slotLabel = FOOD_SLOTS.find((s) => s.key === target.slot)?.label ?? target.slot;
  const items = filterByName(library.library[target.slot], query);
  const trimmed = query.trim();
  const exactMatch = items.some((item) => item.name.toLowerCase() === trimmed.toLowerCase());

  const handleCreate = async () => {
    if (!trimmed || creating) return;
    setCreating(true);
    await onCreateNew(trimmed);
    setCreating(false);
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side={isMobile ? 'bottom' : 'right'} className={isMobile ? 'max-h-[70dvh] overflow-y-auto rounded-t-2xl' : 'w-full overflow-y-auto sm:max-w-xs'}>
        <SheetHeader>
          <SheetTitle>Add food — {slotLabel}</SheetTitle>
          <SheetDescription>{DAY_LABEL[target.day]}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4 pb-6">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or type a new item"
            className="min-h-[44px] rounded-xl border border-border bg-background px-3 text-[13px] text-foreground outline-none"
          />

          <div className="flex flex-col gap-1.5">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onPickExisting(item.id)}
                className="min-h-[44px] rounded-lg border border-border px-3 text-left text-[13px] font-semibold text-foreground"
              >
                {item.name}
              </button>
            ))}

            {trimmed && !exactMatch && (
              <button
                type="button"
                disabled={creating}
                onClick={handleCreate}
                className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-dashed border-primary px-3 text-left text-[13px] font-semibold text-primary disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5 flex-none" />
                {creating ? 'Adding…' : `Add "${trimmed}" as a new item`}
              </button>
            )}

            {items.length === 0 && !trimmed && (
              <p className="py-2 text-center text-[12.5px] text-muted-foreground">Start typing to search or add a food item</p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
