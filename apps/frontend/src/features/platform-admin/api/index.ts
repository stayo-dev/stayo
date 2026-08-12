import api from '@lib/api-client';

function unwrap(response: { data: any }) {
  if (response.data && response.data.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
}

export const platformAdminService = {
  /**
   * The platform's customers. Returns raw per-owner signals; health and
   * at-risk reasons are derived client-side in `owners/ownerHealth.ts` so the
   * rules stay testable without a database.
   */
  getOwners: async (params: { search?: string; limit?: number; offset?: number } = {}) => {
    const response = await api.get('/platform-admin/owners', { params });
    const data = unwrap(response);
    return {
      owners: (data.owners ?? []) as any[],
      total: Number(data.total ?? 0),
      hasMore: Boolean(data.has_more),
      offset: Number(data.offset ?? 0),
    };
  },

  /**
   * One owner, plus their hostels, documents and recent activity. Hostels
   * are served from the owner rather than filtered out of a platform-wide
   * list — a property only means something in the context of whose it is.
   */
  getOwner: async (id: string) => {
    const response = await api.get(`/platform-admin/owners/${id}`);
    return unwrap(response) as { owner: any; hostels: any[]; documents: any[]; activity: any[] };
  },

  getHostels: async (params: { search?: string; verification?: string; listing?: string } = {}) => {
    const response = await api.get('/platform-admin/hostels', { params });
    return unwrap(response).hostels as any[];
  },
  getHostel: async (id: string) => {
    const response = await api.get(`/platform-admin/hostels/${id}`);
    return unwrap(response).hostel;
  },
  approveListing: async (id: string) => {
    const response = await api.post(`/platform-admin/hostels/${id}/approve-listing`);
    return unwrap(response);
  },
  suspendListing: async (id: string) => {
    const response = await api.post(`/platform-admin/hostels/${id}/suspend-listing`);
    return unwrap(response);
  },
  reactivateListing: async (id: string) => {
    const response = await api.post(`/platform-admin/hostels/${id}/reactivate`);
    return unwrap(response);
  },

  /**
   * Paginated. The endpoint also returns per-status counts computed under the
   * same search, so the filter chips can show the shape of the backlog
   * without one request per status.
   */
  getLeads: async (params: { search?: string; status?: string; limit?: number; offset?: number } = {}) => {
    const response = await api.get('/platform-admin/leads', { params });
    const data = unwrap(response);
    return {
      leads: (data.leads ?? []) as any[],
      total: Number(data.total ?? 0),
      hasMore: Boolean(data.has_more),
      offset: Number(data.offset ?? 0),
      counts: (data.counts ?? {}) as Record<string, number>,
    };
  },
  getLead: async (id: string) => {
    const response = await api.get(`/platform-admin/leads/${id}`);
    return unwrap(response);
  },
  updateLeadStatus: async (id: string, status: string) => {
    const response = await api.patch(`/platform-admin/leads/${id}`, { status });
    return unwrap(response);
  },
  approveLead: async (id: string) => {
    const response = await api.post(`/platform-admin/leads/${id}/approve`);
    return unwrap(response) as { lead: any; activationLink?: string; whatsapp_sent: boolean; whatsapp_error?: string; email_sent: boolean; email_error?: string };
  },
  rejectLead: async (id: string, reason: string) => {
    const response = await api.post(`/platform-admin/leads/${id}/reject`, { reason });
    return unwrap(response);
  },
  updateLeadApplicantMessage: async (id: string, applicant_message: string) => {
    const response = await api.patch(`/platform-admin/leads/${id}`, { applicant_message });
    return unwrap(response);
  },

  getOwnerDocuments: async (status: 'PENDING' | 'VERIFIED' | 'REJECTED' = 'PENDING') => {
    const response = await api.get('/platform-admin/owner-documents', { params: { status } });
    return unwrap(response).documents as Array<{
      id: string;
      doc_type: 'AADHAAR' | 'PAN' | 'PHOTO';
      file_url: string;
      mime_type: string;
      status: string;
      uploaded_at: string;
      reviewed_at: string | null;
      review_note: string | null;
      profile: { id: string; name: string; phone: string | null; email: string | null };
    }>;
  },
  reviewOwnerDocument: async (id: string, decision: 'VERIFIED' | 'REJECTED', note?: string) => {
    const response = await api.post(`/platform-admin/owner-documents/${id}/review`, { decision, note });
    return unwrap(response);
  },

  getPlans: async () => {
    const response = await api.get('/platform-admin/plans');
    return unwrap(response).plans as any[];
  },
  createPlan: async (data: { name: string; priceAmount: number; billingCycle: string; description?: string }) => {
    const response = await api.post('/platform-admin/plans', data);
    return unwrap(response);
  },
  assignSubscription: async (hostelId: string, data: { planId: string; autopayEnabled?: boolean }) => {
    const response = await api.post(`/platform-admin/hostels/${hostelId}/subscription`, data);
    return unwrap(response);
  },
  recordInvoice: async (hostelId: string) => {
    const response = await api.post(`/platform-admin/hostels/${hostelId}/invoices`);
    return unwrap(response);
  },
  getRevenue: async () => {
    const response = await api.get('/platform-admin/revenue');
    return unwrap(response) as { kpis: any; metrics: any };
  },
  getRevenueHostels: async (params: { search?: string; status?: string } = {}) => {
    const response = await api.get('/platform-admin/revenue/hostels', { params });
    return unwrap(response).hostels as any[];
  },
  exportRevenueReport: (report: string) => {
    window.open(`${api.defaults.baseURL}/platform-admin/revenue/export?report=${report}`, '_blank');
  },

  getDashboard: async () => {
    const response = await api.get('/platform-admin/dashboard');
    return unwrap(response) as { kpis: any; hostels_preview: any[]; revenue_summary: any };
  },

  getNotifications: async () => {
    const response = await api.get('/platform-admin/notifications');
    return unwrap(response).notifications as Array<{ id: string; time: string; title: string; sub: string; color: string }>;
  },

  getAdmins: async () => {
    const response = await api.get('/platform-admin/admins');
    return unwrap(response).admins as any[];
  },
  inviteAdmin: async (data: { name: string; email: string; title: string }) => {
    const response = await api.post('/platform-admin/admins', data);
    return unwrap(response) as { admin: any; temporary_password: string };
  },
  getNotificationTemplates: async () => {
    const response = await api.get('/platform-admin/notification-templates');
    return unwrap(response).templates as any[];
  },
  toggleTemplateActive: async (id: string, isActive: boolean) => {
    const response = await api.patch(`/platform-admin/notification-templates/${id}`, { isActive });
    return unwrap(response);
  },
  updatePlan: async (id: string, data: { isActive?: boolean; priceAmount?: number }) => {
    const response = await api.patch(`/platform-admin/plans/${id}`, data);
    return unwrap(response);
  },
  getSettings: async () => {
    const response = await api.get('/platform-admin/settings');
    return unwrap(response).settings;
  },
  updateSettings: async (data: { supportEmail?: string; supportPhone?: string; businessAddress?: string }) => {
    const response = await api.patch('/platform-admin/settings', data);
    return unwrap(response).settings;
  },
  sendBroadcast: async (message: string, hostelId?: string) => {
    const response = await api.post('/platform-admin/broadcast', { message, hostel_id: hostelId });
    return unwrap(response) as { sent: number; total: number };
  },
};
