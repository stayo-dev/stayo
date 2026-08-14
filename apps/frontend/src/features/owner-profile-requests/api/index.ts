import api from '@lib/api-client';

function unwrap(response: { data: any }) {
  return response.data?.data ?? response.data;
}

export interface OwnerProfileRequest {
  id: string;
  status: 'PENDING' | 'APPLIED' | 'REJECTED' | string;
  before: Record<string, string | null>;
  diff: Record<string, string | null>;
  reason: string;
  requested_at: string;
  tenant: { id: string; name: string; room_no: string | null } | null;
}

/** Tenant-submitted profile-change requests awaiting owner approval — see `POST /api/tenants/me/profile-requests` on the tenant side. */
export const ownerProfileRequestsService = {
  list: async (status: string = 'PENDING') => {
    const response = await api.get('/owner/profile-requests', { params: { status } });
    return (unwrap(response).requests ?? []) as OwnerProfileRequest[];
  },
  approve: async (id: string) => {
    const response = await api.post(`/owner/profile-requests/${id}/approve`);
    return unwrap(response);
  },
  reject: async (id: string, reason?: string) => {
    const response = await api.post(`/owner/profile-requests/${id}/reject`, { reason });
    return unwrap(response);
  },
};
