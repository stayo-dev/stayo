import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { foodService } from '@features/food/api';
import { useTenantSession } from '@features/tenant-session/useTenantSession';

export interface TenantPollOption {
  id: string;
  label: string;
  position: number;
  votes: number;
}

export interface TenantPoll {
  id: string;
  title: string;
  poll_type: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'RATING' | 'YES_NO';
  meal_type: string;
  poll_date: string;
  closes_at: string;
  allow_multiple: boolean;
  options: TenantPollOption[];
  myOptionIds: string[];
}

const QUERY_KEY = ['tenant', 'food', 'polls'] as const;

/**
 * Tenant-side Food Polls — `GET /api/food/tenant/polls`,
 * `POST /api/food/tenant/polls/:id/vote`. Independent of
 * `useTenantFoodVoting` (dormant, see ADR-056/ADR-057).
 */
export function useTenantFoodPolls() {
  const session = useTenantSession();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => foodService.getTenantPolls() as Promise<TenantPoll[]>,
    enabled: session.isAuthenticated,
    staleTime: 15_000,
  });

  const voteMutation = useMutation({
    mutationFn: ({ pollId, optionId }: { pollId: string; optionId: string }) => foodService.castPollVote(pollId, optionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  return {
    isLoading: query.isLoading,
    polls: query.data ?? [],
    toggleVote: (pollId: string, optionId: string) => voteMutation.mutate({ pollId, optionId }),
    isVoting: voteMutation.isPending,
  };
}
