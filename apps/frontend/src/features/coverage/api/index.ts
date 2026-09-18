import api from '@lib/api-client';

import type { SupplyPayload } from '@/app/pages/public/home/coverageRequest';

/**
 * The only layer that knows the supply-request endpoint's shape. Screens and
 * hooks talk to this; nothing else in the app may name the path.
 */

export interface CoverageRequestResult {
  recorded: boolean;
  will_notify: boolean;
  /** Present on a referral, so a second step can complete it. */
  id?: string;
}

export interface CoverageDetailsPayload {
  owner_contact?: string;
  area_query?: string;
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

  /**
   * Complete a referral already saved by `submit`. Fills blanks only, server
   * side — a second call cannot overwrite the first answer.
   */
  attachDetails: async (id: string, payload: CoverageDetailsPayload): Promise<{ updated: boolean }> => {
    const response = await api.patch(`/discover/coverage-requests/${encodeURIComponent(id)}`, payload);
    return unwrap(response) as { updated: boolean };
  },
};
