import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { foodService } from '@features/food/api';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { SLOT_TO_MEAL_TYPE, toClosesAtIso, type PollRow } from '../polls/pollTypes';
import type { BuiltPoll } from './useCreatePollDraft';

function queryKey(hostelId: string | undefined) {
  return ['owner', 'food', 'polls', hostelId] as const;
}

/**
 * Real Food Polls list + create/edit/close/results-sheet selection —
 * `GET/POST /api/food/polls`, `PATCH/POST .../:id`(edit)/`:id/close`,
 * `GET /api/food/polls/:id/results`. Independent of `useFoodVoting`
 * (dormant, see ADR-056) — see docs/obsidian/Food.md. Returns every poll,
 * newest-first — `FoodPollsPage` groups them by month rather than filtering
 * by an Active/Closed tab.
 */
export function useFoodPolls(hostelId: string | undefined) {
  const queryClient = useQueryClient();
  const [resultsPollId, setResultsPollId] = useState<string | null>(null);

  const pollsQuery = useQuery({
    queryKey: queryKey(hostelId),
    queryFn: () => foodService.getPolls(hostelId!) as Promise<PollRow[]>,
    enabled: Boolean(hostelId),
    staleTime: 15_000,
  });
  const polls = pollsQuery.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKey(hostelId) });

  const createMutation = useMutation({
    mutationFn: (poll: BuiltPoll) =>
      foodService.createPoll({
        hostelId: hostelId!,
        title: poll.title,
        pollType: poll.type,
        mealType: SLOT_TO_MEAL_TYPE[poll.mealCat],
        pollDate: poll.date,
        closesAt: toClosesAtIso(poll.date, poll.closeTime),
        isAnonymous: poll.anon,
        allowMultiple: poll.allowMultiple,
        options: poll.options,
        notifyNow: poll.notify,
      }),
    onSuccess: (_data, poll) => {
      invalidate();
      stayoToast.success(poll.notify ? 'Poll published · tenants notified' : 'Poll published');
    },
    onError: (error: any) => {
      stayoToast.error(error?.response?.data?.error?.message || 'Could not publish poll');
    },
  });

  const closeMutation = useMutation({
    mutationFn: (pollId: string) => foodService.closePoll(pollId),
    onSuccess: () => {
      invalidate();
      stayoToast.success('Poll closed');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ pollId, patch }: { pollId: string; patch: Parameters<typeof foodService.updatePoll>[1] }) =>
      foodService.updatePoll(pollId, patch),
    onSuccess: () => {
      invalidate();
      stayoToast.success('Poll updated');
    },
    onError: (error: any) => {
      stayoToast.error(error?.response?.data?.error?.message || 'Could not update poll');
    },
  });

  const resultsQuery = useQuery({
    queryKey: ['owner', 'food', 'poll-results', resultsPollId],
    queryFn: () => foodService.getPollResults(resultsPollId!),
    enabled: Boolean(resultsPollId),
    staleTime: 5_000,
  });

  return {
    isLoading: pollsQuery.isLoading,
    polls,
    publishPoll: (poll: BuiltPoll) => createMutation.mutate(poll),
    isPublishing: createMutation.isPending,
    closePoll: (pollId: string) => closeMutation.mutate(pollId),
    isClosing: closeMutation.isPending,
    updatePoll: (pollId: string, patch: Parameters<typeof foodService.updatePoll>[1]) => updateMutation.mutate({ pollId, patch }),
    isUpdating: updateMutation.isPending,
    resultsPollId,
    openResults: (id: string) => setResultsPollId(id),
    closeResults: () => setResultsPollId(null),
    results: resultsQuery.data,
    isLoadingResults: resultsQuery.isLoading,
  };
}
