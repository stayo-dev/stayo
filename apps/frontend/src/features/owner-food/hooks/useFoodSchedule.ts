import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { foodService } from '@features/food/api';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { toWeekGrid, DAY_ORDER, type DayKey, type WeekGrid } from '../weekGrid';

// Day order has one definition, in `weekGrid`. Re-exported here only so the
// components that already import it from this hook keep working.
export { DAY_ORDER };
export type { DayKey };

const DAY_LABEL_SHORT: Record<DayKey, string> = {
  MONDAY: 'Monday', TUESDAY: 'Tuesday', WEDNESDAY: 'Wednesday', THURSDAY: 'Thursday',
  FRIDAY: 'Friday', SATURDAY: 'Saturday', SUNDAY: 'Sunday',
};

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
 * `PATCH .../meals/:mealId`, `POST .../publish`. One row per hostel+month,
 * mutable — there's no separate "republish" step, editing a PUBLISHED
 * schedule updates the same row tenants read.
 *
 * Manual-only per ADR-114: there is no generate/rebuild/swap here any more.
 * `createSchedule` is a plain "ensure this month has an (empty) row" call,
 * and `setCellItems` is the single write path for add/remove/reorder alike —
 * the caller (the Timetable page) computes the new ordered id array, this
 * hook just PATCHes it, optimistically, with rollback on failure.
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

  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

  const createMutation = useMutation({
    mutationFn: () => foodService.createSchedule(hostelId!, month),
    onSuccess: invalidate,
  });

  const publishMutation = useMutation({
    mutationFn: () => foodService.publishSchedule(schedule!.id),
    onSuccess: invalidate,
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

  /** The single write path for add/remove/reorder — the caller computes the new ordered array, this sends it. */
  const setCellItems = (mealId: string, menuItemIds: string[]) => {
    const before = schedule?.food_schedule_meals.find((m) => m.id === mealId);
    if (!before) return;
    const previousItemIds = before.food_schedule_meal_items.map((i) => i.menu_item_id).filter((id): id is string => Boolean(id));
    const wasPublished = schedule?.status === 'PUBLISHED';
    const unchanged = previousItemIds.length === menuItemIds.length && previousItemIds.every((id, i) => id === menuItemIds[i]);

    updateMealMutation.mutate(
      { mealId, menuItemIds, expectedUpdatedAt: before.updated_at },
      {
        onSuccess: () => {
          // Nothing to announce and nothing to undo when the saved selection
          // is exactly what the cell already held.
          if (!wasPublished || unchanged) return;
          const dayLabel = DAY_LABEL_SHORT[before.day_of_week];
          stayoToast.undo(`Changed for every ${dayLabel} this month · students see it now`, () => {
            const latest = queryClient.getQueryData<FoodScheduleRow | null>(key)?.food_schedule_meals.find((m) => m.id === mealId);
            updateMealMutation.mutate(
              { mealId, menuItemIds: previousItemIds, expectedUpdatedAt: latest?.updated_at ?? before.updated_at },
              { onError: () => stayoToast.error("Couldn't undo that — the change is still live") },
            );
          });
        },
      },
    );
  };

  const weekGrid: WeekGrid = useMemo(() => toWeekGrid(schedule?.food_schedule_meals), [schedule]);

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
  };
}
