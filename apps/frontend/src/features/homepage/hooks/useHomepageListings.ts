import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@lib/queryKeys';

import { homepageService } from '../api';

/**
 * Browsing is public, so this never gates on a session. A minute of staleness
 * matches the server's own discovery cache rather than fighting it.
 */
export function useHomepageListings() {
  return useQuery({
    queryKey: queryKeys.discover.homepage(),
    queryFn: () => homepageService.listings(),
    staleTime: 60_000,
  });
}
