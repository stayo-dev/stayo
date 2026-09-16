import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@lib/queryKeys';
import { publicPlansApi } from '../api';

/** Public, unauthenticated — powers the landing page's pricing section. */
export function usePublicPlans() {
  return useQuery({
    queryKey: queryKeys.public.subscriptionPlans(),
    queryFn: () => publicPlansApi.getPlans(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
