import { useQuery } from '@tanstack/react-query';
import { foodService } from '@features/food/api';
import { DEFAULT_MEAL_TIMINGS, type MealTimings } from '@features/food/mealTimings';

/**
 * The tenant's own hostel's configured serving windows — read-only, powers
 * the Next Serving card and Today's Meals status on both the tenant Food
 * and Home pages. `staleTime` is generous since this rarely changes.
 */
export function useTenantMealTimings() {
  const query = useQuery({
    queryKey: ['tenant', 'food', 'meal-timings'],
    queryFn: () => foodService.getTenantMealTimings(),
    staleTime: 5 * 60_000,
  });

  return {
    isLoading: query.isLoading,
    mealTimings: (query.data ?? DEFAULT_MEAL_TIMINGS) as MealTimings,
  };
}
