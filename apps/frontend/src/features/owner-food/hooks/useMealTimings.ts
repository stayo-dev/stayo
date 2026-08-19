import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { foodService } from '@features/food/api';
import { DEFAULT_MEAL_TIMINGS, type MealTimings } from '@features/food/mealTimings';
import { stayoToast } from '@shared/ui-patterns/Toast';

function queryKey(hostelId: string | undefined) {
  return ['owner', 'food', 'meal-timings', hostelId] as const;
}

/**
 * The hostel's configured serving windows — `GET/PATCH /api/hostels/:id/meal-timings`.
 * Falls back to `DEFAULT_MEAL_TIMINGS` while loading so callers (TodayCard,
 * the weekly grid header) never need a null check.
 */
export function useMealTimings(hostelId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKey(hostelId),
    queryFn: () => foodService.getMealTimings(hostelId!),
    enabled: Boolean(hostelId),
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: (patch: Partial<MealTimings>) => foodService.updateMealTimings(hostelId!, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey(hostelId), updated);
      stayoToast.success('Meal timings saved');
    },
    onError: (error: any) => stayoToast.error(error?.response?.data?.error?.message || 'Could not save meal timings'),
  });

  return {
    isLoading: query.isLoading,
    mealTimings: (query.data ?? DEFAULT_MEAL_TIMINGS) as MealTimings,
    save: mutation.mutate,
    isSaving: mutation.isPending,
  };
}
