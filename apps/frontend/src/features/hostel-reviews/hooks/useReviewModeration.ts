import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@lib/queryKeys';
import { reviewModerationService } from '../api';

export function useReviewQueue(status: string) {
  return useQuery({
    queryKey: queryKeys.reviews.queue(status),
    queryFn: () => reviewModerationService.list(status),
  });
}

export function useModerateReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, verdict, note }: { id: string; verdict: 'PUBLISH' | 'REJECT'; note?: string | null }) =>
      reviewModerationService.moderate(id, verdict, note),
    onSuccess: () => {
      // Every tab's counts move when one review is decided.
      queryClient.invalidateQueries({ queryKey: queryKeys.reviews.all() });
    },
  });
}
