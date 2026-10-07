import { useMemo } from 'react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { queryKeys } from '@lib/queryKeys';
import { rentReceivedService, type RentReceivedParams } from '../api/rentReceived';

const PAGE = 20;

/**
 * Who paid, newest first, a page at a time.
 *
 * Keyed under `['owner', 'money', …]` on purpose: every place that records a
 * payment (quick collect, confirming a UPI claim) already invalidates that
 * prefix, so a payment he just recorded is at the top of this list when he
 * comes back to it — no manual refresh.
 */
export function useRentReceived(params: RentReceivedParams, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.owner.rentReceived(params),
    queryFn: ({ pageParam }) => rentReceivedService.list(params, pageParam, PAGE),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length * PAGE : undefined),
    enabled,
    staleTime: 30_000,
    // Changing a chip keeps the old rows on screen until the new ones land,
    // instead of flashing an empty list.
    placeholderData: keepPreviousData,
  });

  const payments = useMemo(() => query.data?.pages.flatMap((p) => p.payments) ?? [], [query.data]);

  return {
    payments,
    summary: query.data?.pages[0]?.summary ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
    hasMore: Boolean(query.hasNextPage),
    loadMore: () => query.fetchNextPage(),
    isLoadingMore: query.isFetchingNextPage,
  };
}
