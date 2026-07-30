import api from '@/lib/api-client';

const unwrap = (response: any) => {
  if (response.data?.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
};

export interface ChangeRequestListParams {
  tenantId?: string;
  hostelId?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export interface ChangeRequestSummary {
  id: string;
  entity_type: string;
  change_category: string;
  change_type: string;
  approval_level: string;
  status: string;
  before: Record<string, any>;
  diff: Record<string, any>;
  reason: string;
  effective_date: string | null;
  requested_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  applied_at: string | null;
  cancelled_at: string | null;
  expires_at: string | null;
  tenant: {
    id: string;
    name: string;
    phone: string | null;
  } | null;
  events: Array<{
    id: string;
    action: string;
    actor_role: string;
    notes: string | null;
    created_at: string;
  }>;
}

export interface ChangeRequestDetail extends ChangeRequestSummary {
  entity_id: string;
  entity_version: number;
  creates_version: number | null;
  supersedes_version: number | null;
  hostel: { id: string; name: string } | null;
}

export const changeRequestService = {
  /**
   * List change requests with optional filters.
   */
  list: async (params: ChangeRequestListParams = {}) => {
    const response = await api.get('/change-requests', { params });
    return unwrap(response) as {
      requests: ChangeRequestSummary[];
      total: number;
      page: number;
      limit: number;
    };
  },

  /**
   * Get a single change request with full timeline.
   */
  getById: async (id: string) => {
    const response = await api.get(`/change-requests/${id}`);
    return unwrap(response) as ChangeRequestDetail;
  },

  /**
   * Cancel a pending change request (owner action).
   */
  cancel: async (id: string, reason?: string) => {
    const response = await api.post(`/change-requests/${id}/cancel`, { reason });
    return unwrap(response);
  },

  /**
   * Approve a pending change request (tenant action).
   */
  approve: async (id: string, notes?: string) => {
    const response = await api.post(`/change-requests/${id}/approve`, { notes });
    return unwrap(response);
  },

  /**
   * Reject (decline) a pending change request (tenant action).
   */
  reject: async (id: string, reason: string) => {
    const response = await api.post(`/change-requests/${id}/reject`, { reason });
    return unwrap(response);
  },
};
