import api from '@lib/api-client';

function unwrap(response: { data: any }) {
  if (response.data && response.data.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
}

export interface OwnerServiceRequest {
  id: string;
  type: string;
  category: string | null;
  description: string | null;
  status: string;
  assigned_to: string | null;
  created_at: string;
  tenants: { id: string; profiles: { name: string } | null };
}

export const ownerServiceRequestsService = {
  list: async (hostelId: string, status?: string) => {
    const response = await api.get('/service-requests', { params: { hostelId, status } });
    return unwrap(response).requests as OwnerServiceRequest[];
  },
  updateStatus: async (id: string, data: { status: string; note?: string; assignedTo?: string }) => {
    const response = await api.patch(`/service-requests/${id}/status`, data);
    return unwrap(response);
  },
};
