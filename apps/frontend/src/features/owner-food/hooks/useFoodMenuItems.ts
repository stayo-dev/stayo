import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { foodService } from '@features/food/api';
import type { MealSlotKey } from '@shared/mocks/food';

export interface FoodMenuItemRow {
  id: string;
  name: string;
}

type LibraryBySlot = Record<MealSlotKey, FoodMenuItemRow[]>;

interface EditTarget {
  slot: MealSlotKey;
  id: string;
}

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
 * Real food-item library CRUD — `GET/POST /api/food/menu-items`,
 * `PATCH/DELETE /api/food/menu-items/:id`. Items are hostel-scoped and
 * persist across months (owner maintains this over time, doesn't retype it
 * every month). Drag-reorder from the mock version is dropped — there's no
 * real ordering concept on the backend; items list alphabetically instead.
 */
export function useFoodMenuItems(hostelId: string | undefined) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<Record<MealSlotKey, boolean>>({ breakfast: true, lunch: false, snacks: false, dinner: false });
  const [addOpen, setAddOpen] = useState<MealSlotKey | null>(null);
  const [addText, setAddText] = useState('');
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editText, setEditText] = useState('');

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

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKey(hostelId) });

  const createMutation = useMutation({
    mutationFn: ({ slot, name }: { slot: MealSlotKey; name: string }) => foodService.createMenuItem(hostelId!, SLOT_TO_MEAL_TYPE[slot], name),
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => foodService.updateMenuItem(id, { name }),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => foodService.deleteMenuItem(id),
    onSuccess: invalidate,
  });

  const toggleSection = (slot: MealSlotKey) => {
    setExpanded((s) => ({ ...s, [slot]: !s[slot] }));
    setAddOpen(null);
    setEditTarget(null);
  };

  const startAdd = (slot: MealSlotKey) => {
    setAddOpen(slot);
    setAddText('');
    setEditTarget(null);
  };
  const cancelAdd = () => {
    setAddOpen(null);
    setAddText('');
  };
  const confirmAdd = (slot: MealSlotKey) => {
    const name = addText.trim();
    if (!name) return;
    createMutation.mutate(
      { slot, name },
      {
        onSuccess: () => {
          setAddText('');
          setAddOpen(null);
        },
      },
    );
  };

  const deleteChip = (id: string) => deleteMutation.mutate(id);

  const startEdit = (slot: MealSlotKey, id: string, value: string) => {
    setEditTarget({ slot, id });
    setEditText(value);
    setAddOpen(null);
  };
  const confirmEdit = () => {
    if (!editTarget) return;
    const name = editText.trim();
    if (!name) {
      setEditTarget(null);
      return;
    }
    updateMutation.mutate({ id: editTarget.id, name }, { onSuccess: () => setEditTarget(null) });
  };

  return {
    isLoading: itemsQuery.isLoading,
    library,
    expanded,
    toggleSection,
    addOpen,
    addText,
    setAddText,
    startAdd,
    cancelAdd,
    confirmAdd,
    deleteChip,
    editTarget,
    editText,
    setEditText,
    startEdit,
    confirmEdit,

    /** Creates an item and resolves its id, so a caller can immediately place it in a schedule cell. */
    createAndReturn: async (slot: MealSlotKey, name: string): Promise<string | null> => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      try {
        const created = await createMutation.mutateAsync({ slot, name: trimmed });
        return (created as { id?: string })?.id ?? null;
      } catch {
        return null;
      }
    },
  };
}
