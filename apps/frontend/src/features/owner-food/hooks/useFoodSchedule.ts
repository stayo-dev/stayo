import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { foodService } from '@features/food/api';
import type { MealSlotKey } from '@shared/mocks/food';
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
  menu_item_id: string | null;
  item_name: string;
}

export interface FoodScheduleRow {
  id: string;
  status: 'DRAFT' | 'PUBLISHED';
  source: 'GENERATED' | 'CARRIED_FORWARD' | 'MANUAL';
  /** Set only when the generator was explicitly told to rank this week by votes — no current caller does this; generation is library-driven. */
  generated_from_voting_period_id: string | null;
  published_at: string | null;
  food_schedule_meals: ScheduleMealCell[];
}

export interface ScheduleCellTarget {
  mealId: string;
  slot: MealSlotKey;
}

function scheduleKey(hostelId: string | undefined, month: string) {
  return ['owner', 'food', 'schedule', hostelId, month] as const;
}

/**
 * Real weekly schedule for one hostel+month — `GET /api/food/schedules`,
 * `POST /api/food/schedules/generate`, `PATCH .../meals/:mealId`. One row
 * per hostel+month, mutable — there's no separate "republish" step, editing
 * a PUBLISHED schedule updates the same row tenants read.
 */
export function useFoodSchedule(hostelId: string | undefined, month: string) {
  const queryClient = useQueryClient();
  const [pickerTarget, setPickerTarget] = useState<ScheduleCellTarget | null>(null);

  const scheduleQuery = useQuery({
    queryKey: scheduleKey(hostelId, month),
    queryFn: () => foodService.getSchedule(hostelId!, month) as Promise<FoodScheduleRow | null>,
    enabled: Boolean(hostelId),
    staleTime: 15_000,
  });
  const schedule = scheduleQuery.data ?? null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: scheduleKey(hostelId, month) });

  const generateMutation = useMutation({
    mutationFn: ({ votingPeriodId, mode }: { votingPeriodId?: string; mode: 'BUILD' | 'FILL_GAPS' | 'START_OVER' }) =>
      foodService.generateSchedule(hostelId!, month, votingPeriodId, mode),
    onSuccess: invalidate,
  });

  const updateMealMutation = useMutation({
    mutationFn: ({ mealId, menuItemId }: { mealId: string; menuItemId: string }) => foodService.updateScheduleMeal(schedule!.id, mealId, menuItemId),
    onSuccess: () => {
      invalidate();
      setPickerTarget(null);
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => foodService.publishSchedule(schedule!.id),
    onSuccess: invalidate,
  });

  const swapMealsMutation = useMutation({
    mutationFn: ({ aMealId, bMealId }: { aMealId: string; bMealId: string }) =>
      foodService.swapScheduleMeals(schedule!.id, aMealId, bMealId),
    onSuccess: invalidate,
    // The grid is authoritative, so a refused swap has to re-read rather than
    // leave two chips looking exchanged. What to *say* is decided per call:
    // a failed undo is a different sentence from a failed swap.
    onError: invalidate,
  });

  const dayLabelOf = (mealId: string) => {
    const cell = schedule?.food_schedule_meals.find((m) => m.id === mealId);
    return cell ? DAY_LABEL_SHORT[cell.day_of_week] : 'that day';
  };

  const swapMeals = (aMealId: string, bMealId: string) => {
    const wasPublished = schedule?.status === 'PUBLISHED';
    const dayA = dayLabelOf(aMealId);
    const dayB = dayLabelOf(bMealId);

    swapMealsMutation.mutate(
      { aMealId, bMealId },
      {
        onSuccess: () => {
          // Nothing is live on a draft, so there is nothing to announce and
          // nothing the owner needs a way back from.
          if (!wasPublished) return;
          // Twice the blast radius of a single-cell edit — two weekdays, every
          // occurrence of each this month — so it gets at least the same undo.
          // A swap is its own inverse, which is why undo is the same call.
          stayoToast.undo(`Swapped every ${dayA} and ${dayB} this month · students see it now`, () => {
            swapMealsMutation.mutate(
              { aMealId, bMealId },
              { onError: () => stayoToast.error("Couldn't undo that — the swap is still live") },
            );
          });
        },
        onError: () => stayoToast.error('Could not move that meal'),
      },
    );
  };

  /**
   * The other days this meal could move to — the same swap the drag performs,
   * reachable by tapping. Dragging alone would leave the capability behind a
   * pointer (and behind co-visibility: the week is taller than a phone), which
   * is exactly what ADR-042 point 6 says a drag must not do.
   */
  const moveTargets = useMemo(() => {
    if (!pickerTarget || !schedule) return [];
    const source = schedule.food_schedule_meals.find((m) => m.id === pickerTarget.mealId);
    // An empty cell has nothing to move.
    if (!source?.menu_item_id) return [];
    return schedule.food_schedule_meals
      .filter((m) => m.meal_type === source.meal_type && m.id !== source.id)
      .map((m) => ({
        mealId: m.id,
        day: m.day_of_week,
        dayLabel: DAY_LABEL_SHORT[m.day_of_week],
        itemName: m.item_name,
      }))
      .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
  }, [pickerTarget, schedule]);

  // The single week projection. There used to be a second, raw-row `grid`
  // beside it, which is how the editor came to bypass the `WeekGrid` contract
  // without anything at the call site looking like a violation.
  const weekGrid: WeekGrid = useMemo(() => toWeekGrid(schedule?.food_schedule_meals), [schedule]);

  return {
    isLoading: scheduleQuery.isLoading,
    schedule,
    weekGrid,
    generate: (mode: 'BUILD' | 'FILL_GAPS' | 'START_OVER' = 'BUILD', votingPeriodId?: string) =>
      generateMutation.mutate({ votingPeriodId, mode }),
    isGenerating: generateMutation.isPending,
    pickerTarget,
    openPicker: (target: ScheduleCellTarget) => setPickerTarget(target),
    closePicker: () => setPickerTarget(null),
    pickItem: (menuItemId: string) => {
      if (!pickerTarget) return;
      const before = schedule?.food_schedule_meals.find((m) => m.id === pickerTarget.mealId);
      const previousItemId = before?.menu_item_id ?? null;
      const wasPublished = schedule?.status === 'PUBLISHED';

      updateMealMutation.mutate(
        { mealId: pickerTarget.mealId, menuItemId },
        {
          onSuccess: () => {
            // Nothing to announce and nothing to undo when the owner re-picked
            // the item that was already in the cell.
            if (!wasPublished || !previousItemId || previousItemId === menuItemId) return;
            const dayLabel = before ? DAY_LABEL_SHORT[before.day_of_week] : 'that day';
            stayoToast.undo(`Changed for every ${dayLabel} this month · students see it now`, () => {
              updateMealMutation.mutate(
                { mealId: pickerTarget.mealId, menuItemId: previousItemId },
                // A failed revert must not look like a successful one — the
                // toast is already gone by the time this lands.
                { onError: () => stayoToast.error("Couldn't undo that — the change is still live") },
              );
            });
          },
        },
      );
    },
    isUpdatingMeal: updateMealMutation.isPending,
    publish: () => publishMutation.mutate(),
    isPublishing: publishMutation.isPending,
    swapMeals,
    isSwapping: swapMealsMutation.isPending,
    moveTargets,
    /** Same swap as a drag, from the picker sheet. Closing is the confirmation the sheet is done. */
    moveMeal: (targetMealId: string) => {
      if (!pickerTarget) return;
      swapMeals(pickerTarget.mealId, targetMealId);
      setPickerTarget(null);
    },
  };
}
