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
 * via `createAndReturn`. If item rename/delete is needed again, it belongs
 * behind whatever surface actually needs it, not resurrected here unused.
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
  };
}
