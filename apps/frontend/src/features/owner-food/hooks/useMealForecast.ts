import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@lib/queryKeys';
import { foodService } from '@features/food/api';
import type { MealForecast } from '../mealForecast';

/** Today and tomorrow's numbers, plus the one way to log what was served. */
export function useMealForecast(hostelId: string | null | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.meals.forecast(hostelId),
    queryFn: () => foodService.getMealForecast(hostelId as string) as Promise<MealForecast>,
    enabled: Boolean(hostelId),
    staleTime: 60_000,
  });
  const mutation = useMutation({
    mutationFn: (body: { serveDate: string; mealType: string; servedCount: number }) =>
      foodService.recordMealServed(hostelId as string, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.meals.forecast(hostelId) });
      // Tonight's dinner rides on the Stay surfaces, so they are now stale too.
      queryClient.invalidateQueries({ queryKey: queryKeys.stay.board(hostelId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.stay.summary() });
    },
  });
  return {
    forecast: query.data,
    isLoading: query.isLoading,
    logServed: mutation.mutateAsync,
    isLogging: mutation.isPending,
  };
}
