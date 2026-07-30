import api from '@lib/api-client';

const unwrap = (response) => {
  if (response.data?.success === true && response.data.data !== undefined) {
    return response.data.data;
  }
  return response.data;
};

export const moveOutService = {
  listRequests: async (hostelId, params = {}) => {
    const response = await api.get('/move-out/requests', { params: { hostelId, ...params } });
    return unwrap(response);
  },
  getRequest: async (id) => {
    const response = await api.get(`/move-out/requests/${id}`);
    return unwrap(response);
  },
  getTenantRequest: async () => {
    const response = await api.get('/move-out/tenant');
    return unwrap(response);
  },
  getTimeline: async (params = {}) => {
    const response = await api.get('/move-out/timeline', { params });
    return unwrap(response);
  },
  submitRequest: async (payload) => {
    const response = await api.post('/move-out/requests', payload);
    return unwrap(response);
  },
  cancelRequest: async (requestId) => {
    const response = await api.post(`/move-out/requests/${requestId}/cancel`);
    return unwrap(response);
  },
  inspect: async (requestId, payload) => {
    const response = await api.post(`/move-out/requests/${requestId}/inspect`, payload);
    return unwrap(response);
  },
  settle: async (requestId, payload = {}) => {
    const response = await api.post(`/move-out/requests/${requestId}/settle`, payload);
    return unwrap(response);
  },
  complete: async (requestId, payload = {}) => {
    const response = await api.post(`/move-out/requests/${requestId}/complete`, payload);
    return unwrap(response);
  },
  dispute: async (requestId, payload) => {
    const response = await api.post(`/move-out/requests/${requestId}/dispute`, payload);
    return unwrap(response);
  },
  reviewDispute: async (requestId, disputeId, reviewNotes = '') => {
    const response = await api.post(`/move-out/requests/${requestId}/dispute`, { review: true, disputeId, reviewNotes });
    return unwrap(response);
  },
  resolveDispute: async (requestId, disputeId, resolutionNotes = '') => {
    const response = await api.post(`/move-out/requests/${requestId}/dispute`, { resolve: true, disputeId, resolutionNotes });
    return unwrap(response);
  },
  rejectDispute: async (requestId, disputeId, rejectionNotes = '') => {
    const response = await api.post(`/move-out/requests/${requestId}/dispute`, { reject: true, disputeId, rejectionNotes });
    return unwrap(response);
  },
  feedback: async (requestId, payload) => {
    const response = await api.post(`/move-out/requests/${requestId}/feedback`, payload);
    return unwrap(response);
  },
  vacate: async (requestId, payload = {}) => {
    const response = await api.post(`/move-out/requests/${requestId}/vacate`, payload);
    return unwrap(response);
  },
  reject: async (requestId, payload = {}) => {
    const response = await api.post(`/move-out/requests/${requestId}/reject`, payload);
    return unwrap(response);
  },
  getAnalytics: async (hostelId) => {
    const response = await api.get('/move-out/analytics', { params: { hostelId } });
    return unwrap(response);
  },
};
