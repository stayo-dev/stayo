import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@lib/queryKeys';

import { marketingService, type MarketingContent } from '../api';

export function useMarketingEditor(hostelId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.marketing.editor(hostelId ?? ''),
    queryFn: () => marketingService.getEditorState(hostelId as string),
    enabled: Boolean(hostelId),
  });
}

/**
 * Saves are explicit, not autosaved-on-keystroke: this content is what a human
 * reviewer will read, and a draft that changes under an owner's fingers makes
 * "what did I actually submit" unanswerable.
 */
export function useSaveMarketingDraft(hostelId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: MarketingContent) => marketingService.saveDraft(hostelId as string, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.marketing.editor(hostelId ?? '') });
    },
  });
}

export function useSubmitMarketing(hostelId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => marketingService.submit(hostelId as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.marketing.editor(hostelId ?? '') });
    },
  });
}

export function useWithdrawMarketing(hostelId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => marketingService.withdraw(hostelId as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.marketing.editor(hostelId ?? '') });
    },
  });
}

// ── Admin ──────────────────────────────────────────────────────────────────

export function useMarketingQueue() {
  return useQuery({
    queryKey: queryKeys.marketing.queue(),
    queryFn: () => marketingService.listPending(),
  });
}

export function useMarketingSubmission(revisionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.marketing.submission(revisionId ?? ''),
    queryFn: () => marketingService.getSubmission(revisionId as string),
    enabled: Boolean(revisionId),
  });
}

export function useReviewDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ revisionId, verdict, note, flags }: {
      revisionId: string;
      verdict: 'approve' | 'reject';
      note?: string;
      flags?: { section: string; note?: string }[];
    }) =>
      verdict === 'approve'
        ? marketingService.approve(revisionId, note)
        : marketingService.reject(revisionId, note ?? '', flags ?? []),
    onSuccess: () => {
      // The queue and the item both change; the hostel may also have just
      // become renderable in Discovery.
      queryClient.invalidateQueries({ queryKey: queryKeys.marketing.all() });
      queryClient.invalidateQueries({ queryKey: ['discover'] });
    },
  });
}
