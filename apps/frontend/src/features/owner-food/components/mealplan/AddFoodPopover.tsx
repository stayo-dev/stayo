import { useEffect, useRef, useState } from 'react';
import { Plus, Check, X, Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/app/components/ui/sheet';
import { useIsMobile } from '@/app/components/ui/use-mobile';
import { FOOD_SLOTS, type MealSlotKey } from '@shared/mocks/food';
import type { useFoodMenuItems } from '../../hooks/useFoodMenuItems';
import { filterByName } from '../../timetableDnd';
import { titleCaseText } from '@shared/lib/textFormat';
import type { DayKey, WeekGrid } from '../../weekGrid';
import { countItemUsage, describeItemUsage } from '../../menuItemUsage';

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
  /** `allDays` places the item in this slot on every day of the week, not just the one tapped. */
  onPickExisting: (itemId: string, allDays: boolean) => void;
  onCreateNew: (name: string, allDays: boolean) => void | Promise<void>;
  /** This month's plan, so removing a dish can say how many meals already use it. */
  grid: WeekGrid;
}

/**
 * Replaces `FoodLibraryDrawer.tsx` (ADR-123) — free-text search-and-add
 * scoped to exactly the cell whose "+ Add food" was tapped. Reuses the same
 * `Sheet`/`useIsMobile` bottom-vs-right pattern the drawer established,
 * simplified to one slot's items with no tab bar and no drag affordance —
 * items are added by tap only, dishes already never require dragging to
 * place, only to remove (`TrashDropZone`/the placed chip's own × — untouched
 * by this component). Stays open across multiple picks/creates (2026-08-27)
 * so an owner can add several dishes to one cell in a row — the search box
 * clears and refocuses after each add; the owner closes it themselves (the
 * sheet's own × or tapping outside) once done.
 */
export function AddFoodPopover({ open, onClose, target, library, onPickExisting, onCreateNew, grid }: AddFoodPopoverProps) {
  const isMobile = useIsMobile();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  /**
   * Hostels serve the same thing all week far more often than not — rice and
   * dal at lunch every day — and adding one dish used to mean opening this
   * sheet seven times. Off by default: it changes seven cells at once, so it
   * should be chosen rather than inherited.
   */
  const [allDays, setAllDays] = useState(false);
  /**
   * The row currently asking "remove this?". Inline rather than a modal: this
   * is already a sheet, and stacking a dialog on top of a sheet on a phone
   * buries the question under two layers of scrim.
   */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCreating(false);
      setAllDays(false);
      setConfirmingId(null);
    }
  }, [open, target]);

  if (!target) return null;

  const slotLabel = FOOD_SLOTS.find((s) => s.key === target.slot)?.label ?? target.slot;
  const items = filterByName(library.library[target.slot], query);
  const trimmed = query.trim();
  const exactMatch = items.some((item) => item.name.toLowerCase() === trimmed.toLowerCase());

  const handlePick = (itemId: string) => {
    onPickExisting(itemId, allDays);
    setQuery('');
    inputRef.current?.focus();
  };

  const handleCreate = async () => {
    if (!trimmed || creating) return;
    setCreating(true);
    // Tidied on the way in, not on the way out: this name is stored once and
    // then shown on the tenant's menu, the kitchen sheet and the WhatsApp
    // menu message, so "idly sambar" typed one-handed should not read that way
    // in three places forever. Search stays case-insensitive either way.
    await onCreateNew(titleCaseText(trimmed), allDays);
    setCreating(false);
    setQuery('');
    inputRef.current?.focus();
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
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or type a new item"
            className="min-h-[44px] rounded-xl border border-border bg-background px-3 text-[13px] text-foreground outline-none"
          />

          <button
            type="button"
            onClick={() => setAllDays((v) => !v)}
            aria-pressed={allDays}
            className={`flex min-h-[44px] items-center gap-2.5 rounded-xl border px-3 text-left transition-colors ${
              allDays ? 'border-primary/45 bg-primary/[0.05]' : 'border-border bg-card'
            }`}
          >
            <span
              className={`flex h-5 w-5 flex-none items-center justify-center rounded-md border-2 ${
                allDays ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
              }`}
            >
              {allDays && <Check className="h-3 w-3" strokeWidth={3.2} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-bold text-foreground">Add to every day</span>
              <span className="block text-[11.5px] leading-relaxed text-muted-foreground">
                {slotLabel} on all seven days, not just {DAY_LABEL[target.day]}.
              </span>
            </span>
          </button>

          <div className="flex flex-col gap-1.5">
            {items.map((item) => {
              const usage = describeItemUsage(countItemUsage(grid, item.id));

              if (confirmingId === item.id) {
                return (
                  <div
                    key={item.id}
                    className="rounded-lg border border-destructive/35 bg-destructive/[0.04] px-3 py-2.5"
                  >
                    <p className="text-[13px] font-semibold text-foreground">
                      Remove {titleCaseText(item.name)} from your list?
                    </p>
                    {/* Said plainly, because the removal is soft and the owner
                        cannot see that. Without it they assume they are about
                        to blank several cells of their own week. */}
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                      {usage ?? "It stays on any menus you have already planned with it."}
                    </p>
                    <div className="mt-2.5 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={library.isRemoving}
                        onClick={async () => {
                          const done = await library.remove(item.id, item.name);
                          if (done) setConfirmingId(null);
                        }}
                        className="flex min-h-[36px] items-center gap-1.5 rounded-lg bg-destructive px-3 text-[12.5px] font-bold text-white disabled:opacity-50"
                      >
                        {library.isRemoving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Remove
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="min-h-[36px] rounded-lg px-3 text-[12.5px] font-semibold text-muted-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={item.id}
                  className="flex items-stretch overflow-hidden rounded-lg border border-border"
                >
                  <button
                    type="button"
                    onClick={() => handlePick(item.id)}
                    className="min-h-[44px] flex-1 px-3 text-left text-[13px] font-semibold text-foreground"
                  >
                    {/* Display only — items created before ADR-142 are stored
                        as typed, and the stored value is never rewritten. Same
                        treatment the printed menu gives them. */}
                    {titleCaseText(item.name)}
                  </button>
                  {/* Its own target, well clear of the row's — a mistap here
                      should add the dish, never start removing it. */}
                  <button
                    type="button"
                    aria-label={`Remove ${titleCaseText(item.name)} from your list`}
                    onClick={() => setConfirmingId(item.id)}
                    className="flex w-11 flex-none items-center justify-center border-l border-border text-muted-foreground transition-colors active:bg-muted"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2.2} />
                  </button>
                </div>
              );
            })}

            {trimmed && !exactMatch && (
              <button
                type="button"
                disabled={creating}
                onClick={handleCreate}
                className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-dashed border-primary px-3 text-left text-[13px] font-semibold text-primary disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5 flex-none" />
                {creating ? 'Adding…' : `Add "${titleCaseText(trimmed)}" as a new item`}
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
