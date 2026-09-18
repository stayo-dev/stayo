import { useMutation } from '@tanstack/react-query';

import { coverageService, type CoverageDetailsPayload } from '../api';

/**
 * The second step of a referral. Deliberately fire-and-forget from the page's
 * point of view: the referral is already banked, so a failure here is worth
 * mentioning but never worth blocking on.
 */
export function useAttachCoverageDetails() {
  return useMutation<{ updated: boolean }, unknown, { id: string; payload: CoverageDetailsPayload }>({
    mutationFn: ({ id, payload }) => coverageService.attachDetails(id, payload),
  });
}
