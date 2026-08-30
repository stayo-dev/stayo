import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { foodService } from '@features/food/api';
import type { MealSlotKey } from '@shared/mocks/food';
import { stayoToast } from '@shared/ui-patterns/Toast';

export interface FoodMenuItemRow {
  id: string;
  name: string;
}

type LibraryBySlot = Record<MealSlotKey, FoodMenuItemRow[]>;

const SLOT_TO_MEAL_TYPE: Record<MealSlotKey, string> = {
  breakfast: 'BREAKFAST',
  lunch: 'LUNCH',
  snacks: 'SNACKS',
  dinner: 'DINNER',
};

function queryKey(hostelId: string | undefined) {
  return ['owner', 'food', 'menu-items', hostelId] as const;
}

/**
 * Real food-item library data — `GET/POST /api/food/menu-items`. Items are
 * hostel-scoped and persist across months (owner maintains this over time,
 * doesn't retype it every month). Used to also back a standalone Food
 * Library browsing/edit/delete UI (`FoodLibraryCard.tsx`) — removed (ADR-123)
 * in favor of the Meal Plan editor's inline Add Food popover, which only
 * ever reads `library` (for autocomplete) and creates new items on demand
 * via `createAndReturn`. That note said delete "belongs behind whatever
 * surface actually needs it, not resurrected here unused" — `remove` below is
 * that, added for the Add-food sheet, which is the surface that needed it.
 * Rename is still absent, deliberately, for the same reason. See ADR-145.
 */
export function useFoodMenuItems(hostelId: string | undefined) {
  const queryClient = useQueryClient();

  const itemsQuery = useQuery({
    queryKey: queryKey(hostelId),
    queryFn: () => foodService.getMenuItems(hostelId!),
    enabled: Boolean(hostelId),
    staleTime: 30_000,
  });

  const library: LibraryBySlot = useMemo(() => {
    const grouped: LibraryBySlot = { breakfast: [], lunch: [], snacks: [], dinner: [] };
    for (const item of itemsQuery.data ?? []) {
      const slot = String(item.meal_type).toLowerCase() as MealSlotKey;
      if (grouped[slot]) grouped[slot].push({ id: item.id, name: item.name });
    }
    return grouped;
  }, [itemsQuery.data]);

  const createMutation = useMutation({
    mutationFn: ({ slot, name }: { slot: MealSlotKey; name: string }) => foodService.createMenuItem(hostelId!, SLOT_TO_MEAL_TYPE[slot], name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKey(hostelId) }),
  });

  const removeMutation = useMutation({
    mutationFn: (itemId: string) => foodService.deleteMenuItem(itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKey(hostelId) }),
  });

  return {
    isLoading: itemsQuery.isLoading,
    library,

    /**
     * Creates an item and resolves its id, so a caller can immediately place it
     * in a schedule cell — `null` means it failed and nothing was placed.
     *
     * The failure is spoken, not swallowed: the API answers 409 with "An item
     * with this name already exists for this meal type", which is exactly what
     * the owner needs to hear. A silent null left them staring at an unchanged
     * sheet with their typed name gone.
     */
    createAndReturn: async (slot: MealSlotKey, name: string): Promise<string | null> => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      try {
        const created = await createMutation.mutateAsync({ slot, name: trimmed });
        return (created as { id?: string })?.id ?? null;
      } catch (error: any) {
        stayoToast.error(error?.response?.data?.error?.message || `Could not add "${trimmed}"`);
        return null;
      }
    },

    /**
     * Takes an item out of the hostel's list.
     *
     * The endpoint soft-deletes (`is_active = false`) and never removes the
     * row, because past `food_schedule_meals` still reference it — so meals
     * already planned with this dish keep it, and previous months are
     * unchanged. The wording everywhere says "remove from your list", never
     * "delete", because "delete" would promise a destruction that does not
     * happen and is not wanted.
     */
    remove: async (itemId: string, name: string): Promise<boolean> => {
      try {
        await removeMutation.mutateAsync(itemId);
        stayoToast.success(`Removed ${name}`);
        return true;
      } catch (error: any) {
        stayoToast.error(error?.response?.data?.error?.message || `Could not remove ${name}`);
        return false;
      }
    },
    isRemoving: removeMutation.isPending,
  };
}
