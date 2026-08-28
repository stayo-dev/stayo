import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { foodService } from '@features/food/api';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { applyPendingEdits, clearFlushed, hasPendingChanges as hasPendingChangesFn, setPendingEdit, shouldBufferEdits, type PendingEdits } from '../pendingEdits';
import { toWeekGrid, DAY_ORDER, type DayKey, type WeekGrid } from '../weekGrid';

// Day order has one definition, in `weekGrid`. Re-exported here only so the
// components that already import it from this hook keep working.
export { DAY_ORDER };
export type { DayKey };

export interface ScheduleMealCell {
  id: string;
  day_of_week: DayKey;
  meal_type: string;
  /** `null` until this cell's first-ever edit — a brand-new schedule's 28 cells all start this way. */
  updated_at: string | null;
  /** Ordered dishes, as returned by the API — matches `WeekGridItem`'s shape exactly. */
  food_schedule_meal_items: { id: string; menu_item_id: string | null; item_name: string; display_order: number }[];
  /** @deprecated legacy single-item snapshot — read `food_schedule_meal_items`/`formatCellItems` instead. */
  menu_item_id: string | null;
  /** @deprecated see `menu_item_id` above. */
  item_name: string;
}

export interface FoodScheduleRow {
  id: string;
  status: 'DRAFT' | 'PUBLISHED';
  source: 'GENERATED' | 'CARRIED_FORWARD' | 'MANUAL';
  generated_from_voting_period_id: string | null;
  published_at: string | null;
  food_schedule_meals: ScheduleMealCell[];
}

function scheduleKey(hostelId: string | undefined, month: string) {
  return ['owner', 'food', 'schedule', hostelId, month] as const;
}

/**
 * Real weekly schedule for one hostel+month — `GET/POST /api/food/schedules`,
 * `PATCH .../meals/:mealId`, `POST .../publish`. One row per hostel+month.
 *
 * Manual-only per ADR-114: there is no generate/rebuild/swap here any more.
 * `createSchedule` is a plain "ensure this month has an (empty) row" call.
 * `setCellItems` is still the single write path for add/remove/reorder
 * alike — the caller (the Meal Plan page) computes the new ordered id array
 * — but it now branches on the schedule's status (ADR-123, reversing part of
 * ADR-114): a DRAFT schedule's edits PATCH immediately, optimistic with
 * rollback on failure, exactly as before — a DRAFT row is already invisible
 * to tenants regardless of when it's saved, so there's nothing to protect
 * against. A PUBLISHED schedule's edits instead accumulate in local
 * `pendingEdits` state and are never sent until `saveChanges()` is called —
 * see `pendingEdits.ts` for the pure overlay/tracking logic.
 */
export function useFoodSchedule(hostelId: string | undefined, month: string) {
  const queryClient = useQueryClient();
  const key = scheduleKey(hostelId, month);

  const scheduleQuery = useQuery({
    queryKey: key,
    queryFn: () => foodService.getSchedule(hostelId!, month) as Promise<FoodScheduleRow | null>,
    enabled: Boolean(hostelId),
    staleTime: 15_000,
  });
  const schedule = scheduleQuery.data ?? null;

  const [pendingEdits, setPendingEditsState] = useState<PendingEdits>({});
  const [isSavingChanges, setIsSavingChanges] = useState(false);

  // Safety net — the primary defense against a stale buffer is the nav guard
  // in MealPlanPage.tsx, but a hostel/month swap must never carry another
  // schedule's pending edits along with it.
  useEffect(() => {
    setPendingEditsState({});
  }, [hostelId, month]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

  const createMutation = useMutation({
    mutationFn: () => foodService.createSchedule(hostelId!, month),
    onSuccess: invalidate,
  });

  const publishMutation = useMutation({
    mutationFn: () => foodService.publishSchedule(schedule!.id),
    onSuccess: invalidate,
  });

  /**
   * Copies this schedule to other hostels. Errors (including the
   * `CONFIRM_OVERWRITE` 409) propagate to the caller via `mutateAsync` so
   * `MealPlanPage` can show the overwrite-warning sheet and retry.
   */
  const copyToHostelsMutation = useMutation({
    mutationFn: ({ targetHostelIds, confirmOverwrite }: { targetHostelIds: string[]; confirmOverwrite?: boolean }) =>
      foodService.copyScheduleToHostels(schedule!.id, targetHostelIds, confirmOverwrite),
    onSuccess: (result) => {
      invalidate();
      for (const { hostelId } of result.copied) {
        queryClient.invalidateQueries({ queryKey: scheduleKey(hostelId, month) });
        queryClient.invalidateQueries({ queryKey: ['owner', 'food', 'menu-items', hostelId] });
      }
    },
  });

  const updateMealMutation = useMutation({
    mutationFn: ({ mealId, menuItemIds, expectedUpdatedAt }: { mealId: string; menuItemIds: string[]; expectedUpdatedAt: string | null }) =>
      foodService.updateScheduleMeal(schedule!.id, mealId, menuItemIds, expectedUpdatedAt),
    // Optimistic: the drag/tap gesture that triggered this should look
    // instant, not wait a network round trip — but a failure must leave
    // nothing unpersisted-looking on screen (see ADR-114 §4), hence the
    // snapshot-and-restore below rather than just firing the request.
    onMutate: async ({ mealId, menuItemIds }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previousData = queryClient.getQueryData<FoodScheduleRow | null>(key);
      if (previousData) {
        const itemNameById = new Map(
          previousData.food_schedule_meals.flatMap((m) => m.food_schedule_meal_items.map((i) => [i.menu_item_id, i.item_name] as const)),
        );
        queryClient.setQueryData<FoodScheduleRow>(key, {
          ...previousData,
          food_schedule_meals: previousData.food_schedule_meals.map((m) =>
            m.id === mealId
              ? {
                  ...m,
                  food_schedule_meal_items: menuItemIds.map((id, index) => ({
                    id: `optimistic-${id}`,
                    menu_item_id: id,
                    item_name: itemNameById.get(id) ?? '',
                    display_order: index,
                  })),
                }
              : m,
          ),
        });
      }
      return { previousData };
    },
    onError: (error: any, _vars, context) => {
      if (context?.previousData !== undefined) queryClient.setQueryData(key, context.previousData);
      const code = error?.response?.data?.error?.code;
      stayoToast.error(
        code === 'STALE_WRITE'
          ? 'This meal changed elsewhere — refreshed to the latest version'
          : error?.response?.data?.error?.message || 'Could not save that change',
      );
    },
    onSettled: invalidate,
  });

  /**
   * The single write path for add/remove/reorder. DRAFT: PATCHes immediately
   * (ADR-114, unchanged). PUBLISHED: buffers locally instead (ADR-123) — the
   * caller sees the edit reflected via `weekGrid` below, nothing is sent
   * until `saveChanges()` runs.
   */
  const setCellItems = (mealId: string, menuItemIds: string[]) => {
    const before = schedule?.food_schedule_meals.find((m) => m.id === mealId);
    if (!before) return;

    if (shouldBufferEdits(schedule?.status)) {
      setPendingEditsState((prev) => setPendingEdit(prev, mealId, menuItemIds));
      return;
    }

    updateMealMutation.mutate({ mealId, menuItemIds, expectedUpdatedAt: before.updated_at });
  };

  /** Flushes every buffered edit — one PATCH per dirty cell, each keeping its own optimistic-update/rollback/stale-write guard. */
  const saveChanges = async () => {
    const entries = Object.entries(pendingEdits);
    if (entries.length === 0) return;
    setIsSavingChanges(true);
    const results = await Promise.allSettled(
      entries.map(([mealId, menuItemIds]) => {
        const before = schedule?.food_schedule_meals.find((m) => m.id === mealId);
        return updateMealMutation.mutateAsync({ mealId, menuItemIds, expectedUpdatedAt: before?.updated_at ?? null });
      }),
    );
    const failedMealIds = entries.filter((_, i) => results[i].status === 'rejected').map(([mealId]) => mealId);
    setPendingEditsState((prev) => clearFlushed(prev, failedMealIds));
    setIsSavingChanges(false);
    if (failedMealIds.length === 0) {
      stayoToast.success('Changes saved — tenants can see them now');
    } else {
      stayoToast.error(`${failedMealIds.length} of ${entries.length} change${entries.length === 1 ? '' : 's'} couldn't be saved — try again`);
    }
  };

  /** Drops every buffered edit without sending anything — the schedule reverts to what's actually committed on the server. */
  const discardChanges = () => setPendingEditsState({});

  const committedGrid: WeekGrid = useMemo(() => toWeekGrid(schedule?.food_schedule_meals), [schedule]);
  const weekGrid: WeekGrid = useMemo(() => applyPendingEdits(committedGrid, pendingEdits), [committedGrid, pendingEdits]);

  return {
    isLoading: scheduleQuery.isLoading,
    schedule,
    weekGrid,
    createSchedule: () => createMutation.mutate(),
    isCreating: createMutation.isPending,
    setCellItems,
    isUpdatingMeal: updateMealMutation.isPending,
    publish: () => publishMutation.mutate(),
    isPublishing: publishMutation.isPending,
    copyToHostels: (targetHostelIds: string[], confirmOverwrite = false) =>
      copyToHostelsMutation.mutateAsync({ targetHostelIds, confirmOverwrite }),
    isCopyingToHostels: copyToHostelsMutation.isPending,
    hasPendingChanges: hasPendingChangesFn(pendingEdits),
    saveChanges,
    discardChanges,
    isSavingChanges,
  };
}
