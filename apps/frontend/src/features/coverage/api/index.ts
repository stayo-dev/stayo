import api from '@lib/api-client';

import type { SupplyPayload } from '@/app/pages/public/home/coverageRequest';

/**
 * The only layer that knows the supply-request endpoint's shape. Screens and
 * hooks talk to this; nothing else in the app may name the path.
 */

export interface CoverageRequestResult {
  recorded: boolean;
  will_notify: boolean;
}

function unwrap(response: { data: any }) {
  if (response.data && response.data.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
}

export const coverageService = {
  submit: async (payload: SupplyPayload): Promise<CoverageRequestResult> => {
    const response = await api.post('/discover/coverage-requests', payload);
    return unwrap(response) as CoverageRequestResult;
  },
};
