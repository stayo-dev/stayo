import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ownerService } from '@features/owners/api';
import { queryKeys } from '@lib/queryKeys';

/**
 * Persists the owner's manual hostel order.
 *
 * Optimistic: the list is already showing the new arrangement by the time the
 * request goes out (the owner just dragged it there — snapping back while a
 * request flies would read as the drag having failed, which is the exact
 * complaint this feature exists to fix). On error the previous portfolio
 * snapshot is restored and the caller surfaces a message.
 *
 * See ADR-042.
 */
export function useHostelOrder() {
  const queryClient = useQueryClient();
  const summaryKey = queryKeys.portfolio.summary();

  return useMutation({
    mutationFn: (orderedIds: string[]) => ownerService.reorderHostels(orderedIds),

    onMutate: async (orderedIds: string[]) => {
      await queryClient.cancelQueries({ queryKey: summaryKey });
      const previous = queryClient.getQueryData<any>(summaryKey);

      if (previous?.hostels) {
        const position = new Map(orderedIds.map((id, i) => [id, i]));
        queryClient.setQueryData(summaryKey, {
          ...previous,
          hostels: [...previous.hostels]
            .map((h: any) => ({ ...h, display_order: position.get(h.hostel_id) ?? h.display_order }))
            .sort((a: any, b: any) => (a.display_order ?? Infinity) - (b.display_order ?? Infinity)),
        });
      }

      return { previous };
    },

    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(summaryKey, context.previous);
    },

    // Refetch either way: on success to pick up the server's canonical
    // positions, on failure to discard whatever the optimistic write left.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: summaryKey });
    },
  });
}
