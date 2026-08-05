import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { foodService } from '@features/food/api';
import type { MealSlotKey } from '@shared/mocks/food';
import { toWeekGrid, type WeekGrid } from '../weekGrid';

export const DAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
export type DayKey = (typeof DAY_ORDER)[number];

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
    mutationFn: (votingPeriodId: string | undefined) => foodService.generateSchedule(hostelId!, month, votingPeriodId),
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

  const grid: Record<DayKey, Partial<Record<MealSlotKey, ScheduleMealCell>>> = useMemo(() => {
    const map = Object.fromEntries(DAY_ORDER.map((d) => [d, {}])) as Record<DayKey, Partial<Record<MealSlotKey, ScheduleMealCell>>>;
    for (const meal of schedule?.food_schedule_meals ?? []) {
      const slot = meal.meal_type.toLowerCase() as MealSlotKey;
      map[meal.day_of_week][slot] = meal;
    }
    return map;
  }, [schedule]);

  const weekGrid: WeekGrid = useMemo(() => toWeekGrid(schedule?.food_schedule_meals), [schedule]);

  return {
    isLoading: scheduleQuery.isLoading,
    schedule,
    grid,
    weekGrid,
    generate: (votingPeriodId?: string) => generateMutation.mutate(votingPeriodId),
    isGenerating: generateMutation.isPending,
    pickerTarget,
    openPicker: (target: ScheduleCellTarget) => setPickerTarget(target),
    closePicker: () => setPickerTarget(null),
    pickItem: (menuItemId: string) => {
      if (!pickerTarget) return;
      updateMealMutation.mutate({ mealId: pickerTarget.mealId, menuItemId });
    },
    isUpdatingMeal: updateMealMutation.isPending,
    publish: () => publishMutation.mutate(),
    isPublishing: publishMutation.isPending,
  };
}
