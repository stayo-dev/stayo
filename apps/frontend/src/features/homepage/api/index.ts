import api from '@lib/api-client';

import type { DiscoverCard } from '@features/discover/api';

/**
 * The only layer that knows the homepage endpoint's shape.
 *
 * Separate from the Discover search wrapper on purpose: the homepage asks a
 * different question ("what has the admin chosen to show, in what order"), and
 * the answer carries whether a human decided it.
 */
export interface HomepageListings {
  results: DiscoverCard[];
  facets: { cities: { city: string; count: number }[] };
  total: number;
  /** True when an admin's line-up decided this, not the default sort. */
  curated: boolean;
}

function unwrap(response: { data: any }) {
  if (response.data && response.data.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
}

export const homepageService = {
  listings: async (): Promise<HomepageListings> => {
    const response = await api.get('/discover/homepage-hostels');
    return unwrap(response) as HomepageListings;
  },
};
