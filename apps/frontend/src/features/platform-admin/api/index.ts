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
  /**
   * The homepage line-up (ADR-223) — which hostels the public front page shows
   * and in what order. Replaced wholesale, never patched per row.
   */
  getHomepageFeatures: async () => {
    const response = await api.get('/platform-admin/homepage-features');
    return unwrap(response) as {
      features: Array<{
        hostel_id: string;
        position: number;
        name: string | null;
        city: string | null;
        live_on_homepage: boolean;
        status: string | null;
        listing_status: string | null;
        verification_status: string | null;
      }>;
      candidates: Array<{ id: string; name: string; city: string | null }>;
    };
  },

  setHomepageFeatures: async (hostelIds: string[]) => {
    const response = await api.put('/platform-admin/homepage-features', { hostel_ids: hostelIds });
    return unwrap(response) as { accepted: string[]; rejected: string[]; features: any[] };
  },

  getLeads: async (params: { search?: string; status?: string; source?: string; limit?: number; offset?: number } = {}) => {
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
  resendInvitation: async (id: string) => {
    const response = await api.post(`/platform-admin/leads/${id}/resend-invitation`);
    return unwrap(response) as { lead: any; activationLink?: string; whatsapp_sent: boolean; email_sent: boolean };
  },

  /**
   * Admin -> Add Owner (field/direct marketing). Creates a `platform_leads`
   * row tagged DIRECT_ADMIN — the caller must already have sent+verified the
   * phone via `authApi.sendPhoneOtp`/`verifyPhoneOtp` (purpose
   * PHONE_VERIFICATION); this call only checks that a recent verification
   * exists. Converges into the same approveLead/onboarding pipeline used by
   * website leads.
   */
  createOwnerLead: async (data: { name: string; email: string; phone: string }) => {
    const response = await api.post('/platform-admin/owners', data);
    return unwrap(response) as { id: string; status: string; acquisition_source: string; phone_verified: boolean };
  },
  setOnboardingPlan: async (leadId: string, planCode: string) => {
    const response = await api.patch(`/platform-admin/leads/${leadId}/onboarding-setup`, { plan_code: planCode });
    return unwrap(response) as { id: string; intended_plan_code: string; founding_slots_remaining: number | null };
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

  // ── KYC Approvals (REMOVED) ────────────────────────────────────────────
  // `getOwnerDocuments`/`reviewOwnerDocument` and their
  // `/platform-admin/owner-documents*` backend routes are gone — the Admin
  // Console no longer has an owner-document review screen. The owner-facing
  // upload flow (`/api/owner/kyc-documents`, `document-vault-service.ts`)
  // never depended on this and is untouched.

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

  // ── Admin Settlements (REMOVED) ────────────────────────────────────────
  // `getSettlementRun`/`createSettlementRun`/`startSettlementItem`/
  // `paySettlementItem`/`failSettlementItem` and their `/admin/settlements/
  // run` + `/admin/settlements/items/*` backend routes are gone — the
  // Admin Console no longer has an owner-payout screen. The owner-facing
  // payout backend (`src/services/settlements/owner-payout-read-model.ts`
  // etc., `/api/owner/payouts/*`) was untouched and still serves the owner
  // app's Money tab.

  // ── Legacy per-hostel platform billing (REMOVED — ADR-172) ────────────────
  // `getPlans`/`createPlan`/`assignSubscription`/`recordInvoice`/`getRevenue`/
  // `getRevenueHostels`/`exportRevenueReport` are gone. Stayo billing is
  // owner-level: use `getSubscriptions`, `getSubscriptionRevenue`,
  // `getSubscriptionPlans`, `getSubscriptionPayments` and the subscription
  // action methods below. The backend routes now return 410.

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

  // ── Owner subscription billing (ADR-172, Phase 5) ──────────────────────────
  // The frontend never computes prices, proration, capacity or FOUNDING
  // eligibility — it displays backend values and submits identifiers.

  getSubscriptions: async (params: { status?: string; planCode?: string; search?: string; limit?: number; offset?: number } = {}) => {
    const { planCode, ...rest } = params;
    const response = await api.get('/platform-admin/subscriptions', {
      params: { ...rest, plan_code: planCode },
    });
    return unwrap(response) as {
      subscriptions: any[];
      total: number;
      limit: number;
      offset: number;
      has_more: boolean;
      status_counts: Record<string, number>;
      /** Founding/Starter/Growth/Professional/Portfolio counts (business rules, 2026-09-10). */
      plan_counts: Record<string, number>;
    };
  },
  getSubscriptionDetail: async (id: string) => {
    const response = await api.get(`/platform-admin/subscriptions/${id}`);
    return unwrap(response) as { subscription: any; payments: any[]; invoices: any[] };
  },
  pauseSubscription: async (id: string, reason: string) => {
    const response = await api.post(`/platform-admin/subscriptions/${id}/pause`, { reason });
    return unwrap(response);
  },
  resumeSubscription: async (id: string, reason: string) => {
    const response = await api.post(`/platform-admin/subscriptions/${id}/resume`, { reason });
    return unwrap(response);
  },
  extendSubscription: async (id: string, body: { days?: number; until?: string; reason: string }) => {
    const response = await api.post(`/platform-admin/subscriptions/${id}/override`, body);
    return unwrap(response);
  },
  clearSubscriptionOverride: async (id: string, reason?: string) => {
    const response = await api.delete(`/platform-admin/subscriptions/${id}/override`, { data: { reason } });
    return unwrap(response);
  },
  changeSubscriptionPlan: async (
    id: string,
    body: { plan_id: string; effective: 'IMMEDIATE' | 'NEXT_PERIOD'; reason: string; extra_beds?: number },
  ) => {
    const response = await api.post(`/platform-admin/subscriptions/${id}/change-plan`, body);
    return unwrap(response);
  },
  /**
   * Phase-1 "Mark as Paid & Activate" (business rules, 2026-09-12) — FOUNDING
   * only. Plan, price, included beds and the one-month period are all
   * derived server-side; the only thing this ever sends is an optional
   * free-text payment reference.
   */
  activateFoundingSubscription: async (id: string, reference?: string) => {
    const response = await api.post(`/platform-admin/subscriptions/${id}/activate-founding`, { reference });
    return unwrap(response) as { payment: any; subscription: any; invoice: any; kind: string };
  },

  getSubscriptionPayments: async (status?: string) => {
    const response = await api.get('/platform-admin/subscription-payments', {
      params: status ? { status } : undefined,
    });
    return unwrap(response) as { payments: any[]; total: number };
  },
  approveSubscriptionPayment: async (id: string) => {
    const response = await api.post(`/platform-admin/subscription-payments/${id}/approve`, {});
    return unwrap(response) as { payment: any; subscription: any; invoice: any; kind: string };
  },
  rejectSubscriptionPayment: async (id: string, reason: string) => {
    const response = await api.post(`/platform-admin/subscription-payments/${id}/reject`, { reason });
    return unwrap(response);
  },
  recordCashSubscriptionPayment: async (body: {
    owner_id: string;
    plan_id: string;
    amount_paise: number;
    reference?: string;
    extra_beds?: number;
  }) => {
    const response = await api.post('/platform-admin/subscription-payments/cash', body);
    return unwrap(response) as { id: string; status: string };
  },

  getSubscriptionPlans: async () => {
    const response = await api.get('/platform-admin/plans');
    return unwrap(response) as { plans: any[] };
  },

  getSubscriptionRevenue: async () => {
    const response = await api.get('/platform-admin/revenue');
    return unwrap(response) as {
      currency: string;
      kpis: Record<string, number>;
      subscriptions: Record<string, number>;
      payments: Record<string, number>;
      plan_distribution: any[];
    };
  },

  /**
   * Download a subscription invoice PDF for an admin session. The backend
   * proxies the document (existing `requireAdmin` gate); the raw storage URL is
   * never exposed.
   */
  downloadSubscriptionInvoice: async (invoiceId: string): Promise<{ blob: Blob; filename: string }> => {
    const response = await api.get(`/platform-admin/subscription-invoices/${invoiceId}`, { responseType: 'blob' });
    const disposition = String(response.headers?.['content-disposition'] ?? '');
    const match = disposition.match(/filename="?([^"]+)"?/);
    return { blob: response.data as Blob, filename: match?.[1] ?? `${invoiceId}.pdf` };
  },

  // ── Generic owner payments (NOT subscription payments) ───────────────────
  // A one-off charge Stayo collects from an owner for something other than
  // their subscription — tenant onboarding cost, custom setup work, etc.
  // Deliberately a separate endpoint family from every `subscription-*`
  // method above (see the schema comment on `owner_payments` in
  // prisma/schema.prisma) — never routes through `recordCashSubscriptionPayment`.
  getOwnerPayments: async (ownerId: string) => {
    const response = await api.get(`/platform-admin/owners/${ownerId}/payments`);
    return unwrap(response) as { payments: any[] };
  },
  recordOwnerPayment: async (
    ownerId: string,
    body: {
      amount_paise: number;
      payment_method: 'CASH' | 'UPI' | 'BANK_TRANSFER';
      description: string;
      transaction_reference?: string;
      proof_file_url?: string;
      notes?: string;
      idempotency_key?: string;
    },
  ) => {
    const response = await api.post(`/platform-admin/owners/${ownerId}/payments`, body);
    return unwrap(response) as { payment: any; invoice: any; already_existed: boolean };
  },
  /** Two-step upload: get a proof URL, then pass it as `proof_file_url` to `recordOwnerPayment`. */
  uploadOwnerPaymentProof: async (file: File): Promise<{ url: string }> => {
    const form = new FormData();
    form.append('file', file);
    const response = await api.post('/platform-admin/owner-payments/proof', form);
    return unwrap(response) as { url: string };
  },
  downloadOwnerInvoice: async (invoiceId: string): Promise<{ blob: Blob; filename: string }> => {
    const response = await api.get(`/platform-admin/owner-invoices/${invoiceId}`, { responseType: 'blob' });
    const disposition = String(response.headers?.['content-disposition'] ?? '');
    const match = disposition.match(/filename="?([^"]+)"?/);
    return { blob: response.data as Blob, filename: match?.[1] ?? `${invoiceId}.pdf` };
  },
  /** Retry emailing an invoice — the escape hatch after a missing/failed owner email. */
  resendOwnerInvoice: async (invoiceId: string) => {
    const response = await api.post(`/platform-admin/owner-invoices/${invoiceId}/resend`, {});
    return unwrap(response) as { sent: boolean; reason: string | null };
  },
  /** Retry sending the invoice PDF as a WhatsApp document-template message. Sends the SAME invoice, never creates a new one. */
  resendOwnerInvoiceWhatsApp: async (invoiceId: string) => {
    const response = await api.post(`/platform-admin/owner-invoices/${invoiceId}/resend-whatsapp`, {});
    return unwrap(response) as { sent: boolean; reason: string | null; detail: string | null };
  },

  getBillingSettings: async () => {
    const response = await api.get('/platform-admin/billing-settings');
    return unwrap(response) as { settings: any; configured: boolean };
  },
  saveBillingSettings: async (settings: Record<string, unknown>) => {
    const response = await api.put('/platform-admin/billing-settings', settings);
    return unwrap(response) as { settings: any };
  },
  uploadBillingQr: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const response = await api.post('/platform-admin/billing-settings/qr', form);
    return unwrap(response) as { url: string };
  },

  // ── Managers (Super Admin -> Manager -> hostel assignment, ADR-214) ────────
  // The frontend never decides what a manager may do — every call below is
  // re-checked server-side against manager_permission_grants/
  // manager_hostel_assignments on every request. This layer only shapes
  // requests/responses, same as every other block in this file.

  getManagers: async (params: { search?: string; status?: string } = {}) => {
    const response = await api.get('/platform-admin/managers', { params });
    return unwrap(response).managers as any[];
  },
  getManager: async (id: string) => {
    const response = await api.get(`/platform-admin/managers/${id}`);
    return unwrap(response).manager;
  },
  createManager: async (data: { name: string; phone: string; email: string; permissions: string[] }) => {
    const response = await api.post('/platform-admin/managers', data);
    return unwrap(response) as { manager: any; invitation: { activationLink: string; expiresAt: string } };
  },
  updateManager: async (id: string, data: { name?: string; phone?: string; permissions?: string[] }) => {
    const response = await api.patch(`/platform-admin/managers/${id}`, data);
    return unwrap(response).manager;
  },
  suspendManager: async (id: string, reason?: string) => {
    const response = await api.post(`/platform-admin/managers/${id}/suspend`, { reason });
    return unwrap(response).manager;
  },
  reactivateManager: async (id: string) => {
    const response = await api.post(`/platform-admin/managers/${id}/reactivate`);
    return unwrap(response).manager;
  },
  resendManagerInvitation: async (id: string) => {
    const response = await api.post(`/platform-admin/managers/${id}/resend-invitation`);
    return unwrap(response).invitation as { activationLink: string; expiresAt: string };
  },
  assignManagerHostels: async (id: string, hostelIds: string[]) => {
    const response = await api.post(`/platform-admin/managers/${id}/hostels`, { hostelIds });
    return unwrap(response).manager;
  },
  unassignManagerHostel: async (id: string, hostelId: string) => {
    const response = await api.delete(`/platform-admin/managers/${id}/hostels/${hostelId}`);
    return unwrap(response).manager;
  },
  reassignHostel: async (fromManagerId: string, hostelId: string, toManagerId: string) => {
    const response = await api.post(
      `/platform-admin/managers/${fromManagerId}/hostels/${hostelId}/reassign`,
      { toManagerId },
    );
    return unwrap(response).manager;
  },

  /** Super Admin's manager-activity feed — filters: managerId, hostelId, actionType, entityType, from/to. */
  getManagerActivity: async (params: {
    managerId?: string; hostelId?: string; actionType?: string; entityType?: string; from?: string; to?: string; limit?: number;
  } = {}) => {
    const response = await api.get('/platform-admin/activity', { params });
    return unwrap(response).activity as Array<{
      id: string;
      actionType: string;
      entityType: string;
      entityId: string | null;
      hostelId: string | null;
      actorProfileId: string;
      actorName: string | null;
      actorRole: string | null;
      metadata: any;
      timestamp: string;
    }>;
  },
};
