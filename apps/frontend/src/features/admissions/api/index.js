import api from '@lib/api-client';

const unwrap = (response) => response.data?.data ?? response.data;

export const admissionQrImageUrl = (value, size = 512) =>
  `/admissions/qr-code?size=${size}&data=${encodeURIComponent(value)}`;

export const admissionsPublicService = {
  getVisitHostel: async (slug) => unwrap(await api.get(`/visit/${slug}`)),
  createLead: async (slug, payload) => unwrap(await api.post(`/visit/${slug}/leads`, payload)),
  recordActivity: async (slug, payload) => unwrap(await api.post(`/visit/${slug}/activities`, payload)),
};

export const admissionsService = {
  list: async (params = {}) => unwrap(await api.get('/admissions/leads', { params })),
  createDirect: async (payload) => unwrap(await api.post('/admissions/leads', payload)),
  detail: async (id) => unwrap(await api.get(`/leads/${id}`)),
  updateStatus: async (id, payload) => unwrap(await api.patch(`/leads/${id}`, payload)),
  addNote: async (id, note) => unwrap(await api.post(`/leads/${id}/notes`, { note })),
  reserveRoom: async (id, payload) => unwrap(await api.post(`/leads/${id}/reserve-room`, payload)),
  cancelReservation: async (id, reservationId) =>
    unwrap(await api.patch(`/leads/${id}/reservations/${reservationId}/cancel`)),
  convertToInvitation: async (id, payload) => unwrap(await api.post(`/leads/${id}/convert-to-invitation`, payload)),
  analytics: async (params = {}) => unwrap(await api.get('/admissions/leads/analytics', { params })),
  downloadQrImage: async (value) => {
    const response = await api.get(admissionQrImageUrl(value), { responseType: 'blob' });
    return response.data;
  },
};
