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
  /** The other half of approveListing — a reason is required server-side. */
  rejectListing: async (id: string, reason: string) => {
    const response = await api.post(`/platform-admin/hostels/${id}/reject-listing`, { reason });
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

  /** Correct the postal address. Admin-only; narrow by design (five fields). */
  updateHostelAddress: async (
    id: string,
    address: { address?: string; city?: string; state?: string; pincode?: string },
  ) => {
    const response = await api.patch(`/platform-admin/hostels/${id}`, address);
    return unwrap(response);
  },

  /**
   * Act on a listing that is already live.
   *
   * `REQUEST_CHANGES` leaves the page up and opens a draft for the owner;
   * `UNPUBLISH` takes the content down now. Neither removes the hostel from
   * Discovery — that is `suspendListing`.
   */
  actOnLiveListing: async (
    id: string,
    action: 'REQUEST_CHANGES' | 'UNPUBLISH',
    note: string,
    flags?: { section: string; note?: string }[],
  ) => {
    const response = await api.post(`/platform-admin/hostels/${id}/listing-review`, {
      action,
      note,
      flags,
    });
    return unwrap(response);
  },

  /**
   * Navigation — Google Place ID, landmark, entrance photo, distance.
   *
   * Admin-only on the server too, not just here: this is the field that decides
   * where a student physically walks, and there is deliberately no owner-facing
   * equivalent of these three calls. See migration 074.
   */
  getNavigation: async (id: string) => {
    const response = await api.get(`/platform-admin/hostels/${id}/navigation`);
    return unwrap(response) as { hostel_id: string; navigation: any | null; gaps: string[] };
  },
  /** `navigation: null` clears it — the honest undo for a wrong Place ID. */
  saveNavigation: async (id: string, navigation: any | null) => {
    const response = await api.put(`/platform-admin/hostels/${id}/navigation`, { navigation });
    return unwrap(response) as { hostel_id: string; navigation: any | null; gaps: string[] };
  },
  /** Returns a URL; the drawer persists it with the next saveNavigation. */
  uploadEntrancePhoto: async (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const response = await api.post(`/platform-admin/hostels/${id}/navigation/entrance-photo`, form);
    return unwrap(response) as { url: string };
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

  /**
   * The lead CRM (migration 067) — the outreach log, notes thread,
   * qualification answers and structured lost reasons that let the next call
   * start from what the last one learned.
   */
  getLeadActivities: async (id: string) => {
    const response = await api.get(`/platform-admin/leads/${id}/activities`);
    return unwrap(response).activities as Array<{
      id: string; type: string; outcome: string; note: string | null; created_at: string;
    }>;
  },
  logLeadActivity: async (id: string, data: { type: string; outcome: string; note?: string }) => {
    const response = await api.post(`/platform-admin/leads/${id}/activities`, data);
    return unwrap(response);
  },
  getLeadNotes: async (id: string) => {
    const response = await api.get(`/platform-admin/leads/${id}/notes`);
    return unwrap(response).notes as Array<{
      id: string; body: string; created_at: string; author_name: string;
    }>;
  },
  addLeadNote: async (id: string, body: string) => {
    const response = await api.post(`/platform-admin/leads/${id}/notes`, { body });
    return unwrap(response);
  },
  /** Every field optional and independently clearable — filled in across several calls. */
  saveLeadQualification: async (id: string, data: Record<string, unknown>) => {
    const response = await api.patch(`/platform-admin/leads/${id}/qualification`, data);
    return unwrap(response);
  },
  /** Structured loss, for the insights chart. Distinct from rejectLead, which the owner sees. */
  markLeadLost: async (id: string, reason: string, note?: string) => {
    const response = await api.post(`/platform-admin/leads/${id}/lost`, { reason, note });
    return unwrap(response);
  },
  reopenLead: async (id: string) => {
    const response = await api.delete(`/platform-admin/leads/${id}/lost`);
    return unwrap(response);
  },
  getLeadInsights: async () => {
    const response = await api.get('/platform-admin/leads/insights');
    return unwrap(response) as {
      totals: {
        total_leads: number; lost: number; live: number; with_discovery: number;
        conversion_pct: number | null; loss_pct: number | null;
      };
      lost_reasons: Array<{ reason: string; count: number }>;
      tooling: Array<{ label: string; count: number }>;
      discovery: any[];
    };
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

  /** The Profile → "Raise a Ticket" queue (ADR-079) — Stayo app/website problems, not hostel complaints. */
  getSupportTickets: async (status: 'OPEN' | 'RESOLVED' = 'OPEN') => {
    const response = await api.get('/platform-admin/support-tickets', { params: { status } });
    return unwrap(response).tickets as Array<{
      id: string;
      category: 'APP_BUG' | 'ACCOUNT_ISSUE' | 'PAYMENT_ISSUE' | 'OTHER';
      subject: string;
      description: string;
      status: 'OPEN' | 'RESOLVED';
      created_at: string;
      resolved_at: string | null;
      admin_note: string | null;
      profile: { id: string; name: string; phone: string | null; email: string | null };
    }>;
  },
  resolveSupportTicket: async (id: string, note?: string) => {
    const response = await api.post(`/platform-admin/support-tickets/${id}/resolve`, { note });
    return unwrap(response);
  },

  /** Stayo-authored listings for hostels nobody operates here yet (ADR: platform listings). */
  getPlatformListings: async () => {
    const response = await api.get('/platform-admin/platform-listings');
    return unwrap(response).listings as Array<{
      id: string; name: string; city: string; address: string;
      public_slug: string | null; listing_status: string; verification_status: string;
      enquiry_count: number; created_at: string;
    }>;
  },
  createPlatformListing: async (data: {
    name: string; city: string; address: string; phone: string; hostel_type?: string;
  }) => {
    const response = await api.post('/platform-admin/platform-listings', data);
    return unwrap(response).hostel as { id: string; name: string; city: string; public_slug: string };
  },
  /** Hand a platform listing to its real owner. Refused for owner-managed hostels. */
  assignListingOwner: async (hostelId: string, ownerId: string) => {
    const response = await api.post(`/platform-admin/hostels/${hostelId}/assign-owner`, { owner_id: ownerId });
    return unwrap(response);
  },

  /**
   * Settlements. Stayo pools tenant rent and passes it through in full — every
   * amount here is computed from captured gateway transactions, never typed.
   */
  getSettlementRun: async (date?: string) => {
    const response = await api.get('/admin/settlements/run', { params: date ? { date } : {} });
    return unwrap(response) as {
      date: string;
      run?: { id: string; date: string; status: string; gross_collected: number; owner_count: number } | null;
      lanes?: { pending: any[]; processing: any[]; paid: any[]; failed: any[] };
      totals?: {
        to_settle: number; settled: number;
        pending_count: number; done_count: number; total_count: number;
      };
      items?: any[];
    };
  },
  createSettlementRun: async (date?: string) => {
    const response = await api.post('/admin/settlements/run', date ? { date } : {});
    return unwrap(response);
  },
  startSettlementItem: async (id: string) => {
    const response = await api.post(`/admin/settlements/items/${id}/start`);
    return unwrap(response);
  },
  /** Records a transfer that already happened. Method and reference are both required. */
  paySettlementItem: async (id: string, method: string, reference: string) => {
    const response = await api.post(`/admin/settlements/items/${id}/paid`, { method, reference });
    return unwrap(response);
  },
  failSettlementItem: async (id: string, reason: string) => {
    const response = await api.post(`/admin/settlements/items/${id}/fail`, { reason });
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
