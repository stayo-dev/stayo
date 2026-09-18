import { useMutation } from '@tanstack/react-query';

import { coverageService, type CoverageRequestResult } from '../api';
import type { SupplyPayload } from '@/app/pages/public/home/coverageRequest';

/**
 * No cache invalidation: nothing on the public site reads supply requests
 * back. The owner-facing aggregate is a later phase and has its own key.
 */
export function useSubmitCoverageRequest() {
  return useMutation<CoverageRequestResult, unknown, SupplyPayload>({
    mutationFn: (payload) => coverageService.submit(payload),
  });
}
