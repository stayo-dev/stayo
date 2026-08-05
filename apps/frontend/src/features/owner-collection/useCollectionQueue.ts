import { useQuery } from '@tanstack/react-query';
import { ownerService } from '@features/owners/api';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { queryKeys } from '@lib/queryKeys';
import { queueViewState, type CollectionQueue } from './collectionQueue';

/**
 * Today's collection queue (ADR-045).
 *
 * `staleTime` is short: the owner is actively collecting while this screen is
 * open, and a tenant who just paid must drop out on the next look rather than
 * being chased twice.
 */
export function useCollectionQueue(hostelId?: string) {
  const session = useOwnerSession();

  const query = useQuery({
    queryKey: queryKeys.owner.collectionQueue(hostelId),
    queryFn: ({ signal }) => ownerService.collectionQueue(hostelId, signal) as Promise<any>,
    enabled: session.isAuthenticated,
    staleTime: 15_000,
  });

  const queue: CollectionQueue | undefined = query.data?.data ?? query.data;

  return {
    queue,
    groups: queue?.groups ?? [],
    totalTenants: queue?.totalTenants ?? 0,
    totalOutstanding: queue?.totalOutstanding ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    state: queueViewState({ isLoading: query.isLoading, isError: query.isError, queue }),
  };
}
