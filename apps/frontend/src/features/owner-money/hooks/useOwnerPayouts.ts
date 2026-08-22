import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@lib/queryKeys';
import { ownerPayoutService } from '@features/owner-payouts/api';
import { stripVoice, promiseLine } from '../payouts/payoutState';

/**
 * The payout strip's data.
 *
 * `staleTime` is short on purpose: the strip's job is to tell an owner someone
 * paid him roughly when it happens, which is the thing that replaces the
 * feeling of being handed cash. A five-minute cache would make it a report.
 */
export function useOwnerPayoutSummary() {
  const query = useQuery({
    queryKey: queryKeys.owner.payoutSummary(),
    queryFn: () => ownerPayoutService.getSummary(),
    staleTime: 30_000,
  });

  return {
    summary: query.data ?? null,
    voice: stripVoice(query.data),
    promise: promiseLine(query.data?.promise),
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

export function useOwnerPayouts(q?: string) {
  const query = useQuery({
    queryKey: queryKeys.owner.payouts(q),
    queryFn: () => ownerPayoutService.list(q),
    staleTime: 30_000,
  });
  return { payouts: query.data ?? [], isLoading: query.isLoading };
}

/** Lazy: the tenant breakdown is only fetched when a payout row is opened. */
export function useOwnerPayoutBreakdown(itemId: string | null) {
  const query = useQuery({
    queryKey: queryKeys.owner.payoutBreakdown(itemId ?? ''),
    queryFn: () => ownerPayoutService.getBreakdown(itemId as string),
    enabled: Boolean(itemId),
    staleTime: 5 * 60_000,
  });
  return { breakdown: query.data ?? null, isLoading: query.isLoading };
}
