import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@lib/queryKeys';
import { ownerPaymentsApi } from '../api';

/** The owner's own generic (non-subscription) payment history. */
export function useOwnerPayments() {
  return useQuery({
    queryKey: queryKeys.owner.payments(),
    queryFn: () => ownerPaymentsApi.list(),
    staleTime: 30_000,
  });
}
