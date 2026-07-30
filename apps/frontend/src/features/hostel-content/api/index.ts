import api from '@lib/api-client';

function unwrap(response: { data: any }) {
  if (response.data && response.data.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
}

export interface HostelAnnouncement {
  id: string;
  hostel_id: string;
  title: string;
  body: string;
  created_at: string;
}

export interface HostelEvent {
  id: string;
  hostel_id: string;
  title: string;
  event_date: string;
  description: string | null;
}

export const hostelContentService = {
  // Owner
  getAnnouncements: async (hostelId: string) => {
    const response = await api.get('/announcements', { params: { hostelId } });
    return unwrap(response).announcements as HostelAnnouncement[];
  },
  createAnnouncement: async (hostelId: string, title: string, body: string) => {
    const response = await api.post('/announcements', { hostelId, title, body });
    return unwrap(response);
  },
  deleteAnnouncement: async (id: string) => {
    const response = await api.delete(`/announcements/${id}`);
    return unwrap(response);
  },
  getEvents: async (hostelId: string, upcomingOnly = false) => {
    const response = await api.get('/hostel-events', { params: { hostelId, upcomingOnly } });
    return unwrap(response).events as HostelEvent[];
  },
  createEvent: async (hostelId: string, title: string, eventDate: string, description?: string) => {
    const response = await api.post('/hostel-events', { hostelId, title, eventDate, description });
    return unwrap(response);
  },
  deleteEvent: async (id: string) => {
    const response = await api.delete(`/hostel-events/${id}`);
    return unwrap(response);
  },

  // Tenant
  getTenantAnnouncements: async () => {
    const response = await api.get('/tenants/me/announcements');
    return unwrap(response).announcements as HostelAnnouncement[];
  },
  getTenantEvents: async () => {
    const response = await api.get('/tenants/me/events');
    return unwrap(response).events as HostelEvent[];
  },
};
