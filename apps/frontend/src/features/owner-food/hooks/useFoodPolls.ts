import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { foodService } from '@features/food/api';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { SLOT_TO_MEAL_TYPE, type PollRow, type PollStatus } from '../polls/pollTypes';
import type { BuiltPoll } from './useCreatePollDraft';

function queryKey(hostelId: string | undefined) {
  return ['owner', 'food', 'polls', hostelId] as const;
}

function toClosesAtIso(date: string, time: string): string {
  // Both are local wall-clock inputs from <input type="date">/<input type="time">; combine as local time.
  return new Date(`${date}T${time}:00`).toISOString();
}

/**
 * Real Food Polls list + create/close/results-sheet selection —
 * `GET/POST /api/food/polls`, `POST /api/food/polls/:id/close`,
 * `GET /api/food/polls/:id/results`. Independent of `useFoodVoting`
 * (dormant, see ADR-056) — see docs/obsidian/Food.md.
 */
export function useFoodPolls(hostelId: string | undefined) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<PollStatus>('OPEN');
  const [resultsPollId, setResultsPollId] = useState<string | null>(null);

  const pollsQuery = useQuery({
    queryKey: queryKey(hostelId),
    queryFn: () => foodService.getPolls(hostelId!) as Promise<PollRow[]>,
    enabled: Boolean(hostelId),
    staleTime: 15_000,
  });
  const polls = pollsQuery.data ?? [];
  const filtered = polls.filter((p) => p.status === tab);

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
      setTab('OPEN');
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

  const resultsQuery = useQuery({
    queryKey: ['owner', 'food', 'poll-results', resultsPollId],
    queryFn: () => foodService.getPollResults(resultsPollId!),
    enabled: Boolean(resultsPollId),
    staleTime: 5_000,
  });

  return {
    isLoading: pollsQuery.isLoading,
    polls: filtered,
    tab,
    setTab,
    publishPoll: (poll: BuiltPoll) => createMutation.mutate(poll),
    isPublishing: createMutation.isPending,
    closePoll: (pollId: string) => closeMutation.mutate(pollId),
    isClosing: closeMutation.isPending,
    resultsPollId,
    openResults: (id: string) => setResultsPollId(id),
    closeResults: () => setResultsPollId(null),
    results: resultsQuery.data,
    isLoadingResults: resultsQuery.isLoading,
  };
}
