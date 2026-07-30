import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { foodService } from '@features/food/api';

export interface FoodVotingPeriod {
  id: string;
  month: string;
  voting_starts_at: string;
  voting_ends_at: string;
  status: 'DRAFT' | 'OPEN' | 'CLOSED';
}

function periodKey(hostelId: string | undefined, month: string) {
  return ['owner', 'food', 'voting-period', hostelId, month] as const;
}

/**
 * Real voting-period lifecycle for one hostel+month — `GET/POST /api/food/
 * voting-periods`, `POST .../close`, `GET .../results` (live per-meal-type
 * tally once votes exist).
 */
export function useFoodVoting(hostelId: string | undefined, month: string) {
  const queryClient = useQueryClient();

  const periodQuery = useQuery({
    queryKey: periodKey(hostelId, month),
    queryFn: () => foodService.getVotingPeriod(hostelId!, month) as Promise<FoodVotingPeriod | null>,
    enabled: Boolean(hostelId),
    staleTime: 15_000,
  });
  const period = periodQuery.data ?? null;

  const resultsQuery = useQuery({
    queryKey: ['owner', 'food', 'voting-results', period?.id],
    queryFn: () => foodService.getVotingResults(period!.id),
    enabled: Boolean(period?.id),
    staleTime: 15_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: periodKey(hostelId, month) });
    queryClient.invalidateQueries({ queryKey: ['owner', 'food', 'voting-results'] });
  };

  const openMutation = useMutation({
    mutationFn: ({ startsAt, endsAt }: { startsAt: string; endsAt: string }) =>
      foodService.openVoting(hostelId!, month, startsAt, endsAt),
    onSuccess: invalidate,
  });

  const closeMutation = useMutation({
    mutationFn: () => foodService.closeVoting(period!.id),
    onSuccess: invalidate,
  });

  return {
    isLoading: periodQuery.isLoading,
    period,
    results: resultsQuery.data,
    isLoadingResults: resultsQuery.isLoading,
    openVoting: (startsAt: string, endsAt: string) => openMutation.mutate({ startsAt, endsAt }),
    isOpening: openMutation.isPending,
    closeVoting: () => closeMutation.mutate(),
    isClosing: closeMutation.isPending,
  };
}
