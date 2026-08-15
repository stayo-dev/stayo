import api from '@lib/api-client';

import type { ResidencyStay } from '@features/profile/api';

/**
 * A tenant's residency history, as this owner is permitted to see it.
 *
 * The server decides disclosure — see ADR-053's amendment. `allowed: false`
 * carries a reason so the UI can tell "they haven't engaged you yet" from
 * "they said no", without either revealing whether the person has any history.
 */
export interface DisclosedHistory {
  allowed: boolean;
  reason: 'TENANCY' | 'OPEN_ENQUIRY' | 'TENANT_APPROVED' | 'TENANT_DECLINED' | 'AWAITING_TENANT' | 'NOT_ENGAGED';
  stays: ResidencyStay[];
  total_stays: number;
  total_months: number;
}

function unwrap(response: { data: any }) {
  if (response.data && response.data.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
}

export const tenantHistoryService = {
  /** For an existing tenancy. `tenant_id` resolves to the person server-side. */
  byTenant: async (tenantId: string): Promise<DisclosedHistory> => {
    const response = await api.get('/owner/tenant-history', { params: { tenant_id: tenantId } });
    return unwrap(response) as DisclosedHistory;
  },

  /** For an enquiry or a prospective invite, where no tenancy exists yet. */
  byProfile: async (hostelId: string, profileId: string): Promise<DisclosedHistory> => {
    const response = await api.get('/owner/tenant-history', {
      params: { hostel_id: hostelId, profile_id: profileId },
    });
    return unwrap(response) as DisclosedHistory;
  },

  /** Ask someone to share their history. Grants nothing on its own. */
  request: async (hostelId: string, profileId: string) => {
    const response = await api.post('/owner/tenant-history/request', {
      hostel_id: hostelId,
      profile_id: profileId,
    });
    return unwrap(response) as { requested: boolean; status: string };
  },
};
