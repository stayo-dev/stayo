import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@lib/queryKeys';
import { useAuth } from '@context/AuthContext';

import {
  discoverService,
  type DiscoverCard,
  type DiscoverFilters,
  type DiscoverEnquiry,
} from '../api';

/** Browsing is public, so these two never gate on a session. */
export function useDiscoverSearch(filters: DiscoverFilters) {
  return useQuery({
    queryKey: queryKeys.discover.search(filters),
    queryFn: () => discoverService.search(filters),
    // Results shift as beds fill; a minute of staleness matches the server's
    // own search cache rather than fighting it.
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
}

export function useDiscoverListing(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.discover.listing(slug ?? ''),
    queryFn: () => discoverService.getListing(slug as string),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });
}

/** A seeker is any signed-in resident account — a tenancy is not required. */
export function useIsSeeker() {
  const { user, loading } = useAuth();
  return {
    loading,
    isSeeker: Boolean(user && user.role?.toLowerCase() === 'tenant'),
    user,
  };
}

/** A hostel's published reviews (public), with the reader's own attached. */
export function useHostelReviews(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.discover.reviews(slug ?? ''),
    queryFn: () => discoverService.listReviews(slug as string),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });
}

/**
 * Write a review. No optimistic insert into the list: the review is not
 * published yet and showing it there would tell the writer a lie about what
 * the public can see.
 */
export function useSubmitReview(slug: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { categories: Record<string, number>; body?: string | null }) =>
      discoverService.submitReview(slug as string, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.discover.reviews(slug ?? '') });
    },
  });
}

export function useSavedHostels() {
  const { isSeeker } = useIsSeeker();
  return useQuery({
    queryKey: queryKeys.discover.saved(),
    queryFn: () => discoverService.listSaved(),
    enabled: isSeeker,
  });
}

/**
 * Save/unsave with an optimistic flip. The heart has to respond instantly —
 * a round-trip of dead time on a tap that means "keep this one" reads as a
 * broken control, and the failure path is a rollback, not a lost hostel.
 */
export function useToggleSaved() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ hostelId, saved }: { hostelId: string; saved: boolean; card?: DiscoverCard }) =>
      saved ? discoverService.unsave(hostelId) : discoverService.save(hostelId),

    onMutate: async ({ hostelId, saved, card }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.discover.saved() });
      const previous = queryClient.getQueryData<DiscoverCard[]>(queryKeys.discover.saved());

      queryClient.setQueryData<DiscoverCard[]>(queryKeys.discover.saved(), (current) => {
        const list = current ?? [];
        if (saved) return list.filter((item) => item.id !== hostelId);
        if (list.some((item) => item.id === hostelId)) return list;
        // Without the card we cannot render a believable optimistic row, so
        // leave the list alone and let the refetch fill it in.
        return card ? [{ ...card, saved_at: new Date().toISOString() }, ...list] : list;
      });

      return { previous };
    },

    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.discover.saved(), context.previous);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.discover.saved() });
    },
  });
}

export function useEnquiries() {
  const { isSeeker } = useIsSeeker();
  return useQuery({
    queryKey: queryKeys.discover.enquiries(),
    queryFn: () => discoverService.listEnquiries(),
    enabled: isSeeker,
  });
}

export function useEnquiry(id: string | undefined) {
  const { isSeeker } = useIsSeeker();
  return useQuery({
    queryKey: queryKeys.discover.enquiry(id ?? ''),
    queryFn: () => discoverService.getEnquiry(id as string),
    enabled: isSeeker && Boolean(id),
  });
}

export function useCreateEnquiry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: discoverService.createEnquiry,
    onSuccess: (enquiry: DiscoverEnquiry) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.discover.enquiries() });
      queryClient.setQueryData(queryKeys.discover.enquiry(enquiry.id), enquiry);
    },
  });
}
