import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@lib/queryKeys';
import { foodService } from '@features/food/api';
import type { MealChoice } from '../specialMeals';

export function useSpecialMeals(hostelId: string | null | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.meals.special.occasions(hostelId),
    queryFn: () => foodService.listSpecialMeals(hostelId as string),
    enabled: Boolean(hostelId),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.meals.special.occasions(hostelId) });
  const create = useMutation({ mutationFn: (body: Parameters<typeof foodService.createSpecialMeal>[1]) => foodService.createSpecialMeal(hostelId as string, body), onSuccess: invalidate });
  const update = useMutation({
    mutationFn: ({ occasionId, body }: { occasionId: string; body: Parameters<typeof foodService.updateSpecialMeal>[2] }) =>
      foodService.updateSpecialMeal(hostelId as string, occasionId, body),
    onSuccess: () => {
      invalidate();
      // Policy changes move the cook numbers.
      qc.invalidateQueries({ queryKey: ['hostel', hostelId, 'meals', 'special'] });
    },
  });
  return { occasions: query.data ?? [], isLoading: query.isLoading, create: create.mutateAsync, update: update.mutateAsync };
}

export function useSpecialMealCount(hostelId: string | null | undefined, occasionId: string | null | undefined, date?: string) {
  const qc = useQueryClient();
  const key = queryKeys.meals.special.count(hostelId, occasionId ?? '', date);
  const query = useQuery({
    queryKey: key,
    queryFn: () => foodService.getSpecialMealCount(hostelId as string, occasionId as string, date),
    enabled: Boolean(hostelId && occasionId),
    staleTime: 30_000,
  });
  const mutation = useMutation({
    mutationFn: (body: { tenantId: string; serveDate: string; choice: MealChoice | null }) =>
      foodService.setSpecialMealAnswer(hostelId as string, occasionId as string, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const ready = useMutation({
    mutationFn: (choice: 'VEG' | 'NON_VEG' | 'BOTH') => foodService.sendSpecialMealReady(hostelId as string, occasionId as string, choice),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    setAnswer: mutation.mutateAsync,
    isSaving: mutation.isPending,
    sendReady: ready.mutateAsync,
    isSendingReady: ready.isPending,
  };
}
