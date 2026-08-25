const ownerKey = (...parts: unknown[]) => ['owner', ...parts];
const hostelKey = (hostelId: string | null | undefined, ...parts: unknown[]) => {
  if (!hostelId) return ['__noop__', ...parts];
  return ['hostel', hostelId, ...parts];
};

export const queryKeys = {
  me: () => ownerKey('me'),

  owner: {
    hostels: () => ownerKey('hostels'),
    profile: () => ownerKey('profile'),
    /** Today's collection queue; hostel-scoped when a hostel is chosen. See ADR-045. */
    collectionQueue: (hostelId?: string) => ownerKey('collection-queue', hostelId ?? 'all'),
    pendingDocuments: () => ownerKey('pending-documents'),
    /** A tenant's disclosed residency history — see ADR-053's amendment. */
    tenantHistory: (tenantId: string) => ownerKey('tenant-history', tenantId),
    /** Same disclosed history, looked up by hostel+profile — the enquiry/invite path, before a tenancy exists. */
    tenantHistoryByProfile: (hostelId: string, profileId: string) => ownerKey('tenant-history', hostelId, profileId),
    renewalQueue: () => ownerKey('renewal-queue'),
    /**
     * Money Stayo is holding for this owner. Portfolio-level, never hostel-keyed:
     * a payout is one bank transfer covering every hostel at once, so a
     * hostel-scoped cache entry would describe a figure that appears on no
     * bank statement.
     */
    payoutSummary: () => ownerKey('payouts', 'summary'),
    payouts: (q?: string) => ownerKey('payouts', 'list', q ?? ''),
    payoutBreakdown: (itemId: string) => ownerKey('payouts', 'breakdown', itemId),
    invitedCounts: (hostelIds: string[]) => ownerKey('invited-counts', [...hostelIds].sort()),
    // Expenses are portfolio-level, not per-hostel (expenseService.create strips
    // hostelId from the payload) — keyed at the owner level, not hostelKey(...).
    expenses: (params?: object) => ownerKey('expenses', params ?? {}),
    cashflow: (hostelIds: string[], from: string, to: string) =>
      ownerKey('cashflow', [...hostelIds].sort(), from, to),
  },

  notifications: () => ownerKey('notifications'),

  portfolio: {
    all: () => ownerKey('portfolio'),
    summary: () => ownerKey('portfolio', 'summary'),
    shell: (months?: number) => ownerKey('portfolio', 'shell', months ?? 6),
    performance: (months?: number) => ownerKey('portfolio', 'performance', months ?? 6),
  },

  analytics: {
    all: (hostelId: string) => hostelKey(hostelId, 'analytics'),
  },

  dashboard: {
    all: (hostelId: string) => hostelKey(hostelId, 'dashboard'),
    stats: (hostelId: string) => hostelKey(hostelId, 'dashboard', 'stats'),
    statsShell: (hostelId: string) => hostelKey(hostelId, 'dashboard', 'stats-shell'),
    statsActivity: (hostelId: string) => hostelKey(hostelId, 'dashboard', 'stats-activity'),
    statsAnalytics: (hostelId: string) => hostelKey(hostelId, 'dashboard', 'stats-analytics'),
    summary: (hostelId: string) => hostelKey(hostelId, 'dashboard', 'summary'),
    monthly: (hostelId: string, months?: number) =>
      hostelKey(hostelId, 'dashboard', 'monthly', months ?? 6),
    cashflow: (hostelId: string) => hostelKey(hostelId, 'dashboard', 'cashflow'),
    funnel: (hostelId: string) => hostelKey(hostelId, 'dashboard', 'funnel'),
    operations: (hostelId: string) => hostelKey(hostelId, 'dashboard', 'operations'),
  },

  tenants: {
    all: (hostelId: string) => hostelKey(hostelId, 'tenants'),
    list: (hostelId: string, filters?: object) =>
      hostelKey(hostelId, 'tenants', 'list', filters ?? {}),
    detail: (hostelId: string, id: string) =>
      hostelKey(hostelId, 'tenants', 'detail', id),
    overview: (hostelId: string, id: string) =>
      hostelKey(hostelId, 'tenants', 'overview', id),
    full: (hostelId: string, id: string) =>
      hostelKey(hostelId, 'tenants', 'full', id),
    dashboard: (hostelId: string) => hostelKey(hostelId, 'tenants', 'dashboard'),
    allocations: (hostelId: string, tenantId: string) =>
      hostelKey(hostelId, 'tenants', tenantId, 'allocations'),
    obligations: (hostelId: string, tenantId: string) =>
      hostelKey(hostelId, 'tenants', tenantId, 'obligations'),
    advance: (hostelId: string, tenantId: string) =>
      hostelKey(hostelId, 'tenants', tenantId, 'advance'),
    financialTimeline: (hostelId: string, tenantId: string) =>
      hostelKey(hostelId, 'tenants', tenantId, 'financial-timeline'),
    ownerActions: (hostelId: string, tenantId: string) =>
      hostelKey(hostelId, 'tenants', tenantId, 'owner-actions'),
    documents: (hostelId: string, tenantId: string) =>
      hostelKey(hostelId, 'tenants', tenantId, 'documents'),
    activity: (hostelId: string, tenantId: string) =>
      hostelKey(hostelId, 'tenants', tenantId, 'activity'),
    paymentHistory: (hostelId: string, id: string) =>
      hostelKey(hostelId, 'tenants', id, 'payments'),
    moveOut: (hostelId: string, tenantId?: string) =>
      hostelKey(hostelId, 'move-out', tenantId ?? 'all'),
    reactivation: () => ownerKey('reactivation-requests'),
  },

  moveOut: {
    all: (hostelId: string) => hostelKey(hostelId, 'move-out'),
    list: (hostelId: string, status?: string) =>
      hostelKey(hostelId, 'move-out', 'list', status ?? 'all'),
    detail: (hostelId: string, id: string) => hostelKey(hostelId, 'move-out', 'detail', id),
  },

  rooms: {
    all: (hostelId: string) => hostelKey(hostelId, 'rooms'),
    list: (hostelId: string, params?: object) =>
      hostelKey(hostelId, 'rooms', 'list', params ?? {}),
    detail: (hostelId: string, id: string) =>
      hostelKey(hostelId, 'rooms', 'detail', id),
  },

  payments: {
    all: (hostelId: string) => hostelKey(hostelId, 'payments'),
    ledger: (hostelId: string, params?: object) =>
      hostelKey(hostelId, 'payments', 'ledger', params ?? {}),
    dues: (hostelId: string, params?: object) =>
      hostelKey(hostelId, 'payments', 'dues', params ?? {}),
    detail: (hostelId: string, obligationId: string) =>
      hostelKey(hostelId, 'payments', 'detail', obligationId),
  },

  expenses: {
    all: (hostelId: string) => hostelKey(hostelId, 'expenses'),
    list: (hostelId: string) => hostelKey(hostelId, 'expenses', 'list'),
  },

  activity: {
    all: (hostelId: string) => hostelKey(hostelId, 'activity'),
    list: (hostelId: string, params?: object) =>
      hostelKey(hostelId, 'activity', 'list', params ?? {}),
  },

  admissions: {
    all: () => ownerKey('admissions'),
    list: (filters?: object) => ownerKey('admissions', 'list', filters ?? {}),
    detail: (id: string) => ownerKey('admissions', 'detail', id),
    analytics: (filters?: object) => ownerKey('admissions', 'analytics', filters ?? {}),
    visit: (slug: string) => ['public', 'visit', slug],
  },

  /**
   * Stayo Discover. Namespaced under 'discover' rather than 'owner' because
   * none of it is owner-scoped — search and listing detail are public, and the
   * rest belongs to the signed-in seeker, not to a hostel.
   */
  /**
   * The portable Stayo profile (phase B). Person-scoped, not owner- or
   * hostel-scoped, so it sits outside both `ownerKey` and `hostelKey`.
   */
  /**
   * The hostel marketing page and its review queue. Namespaced together
   * because the owner's editor and the admin's queue read the same revision —
   * an approval must invalidate both.
   */
  /** Hostel reviews — the admin moderation queue and insights view. */
  reviews: {
    all: () => ['reviews'],
    queue: (status: string) => ['reviews', 'queue', status],
    insights: (filters: object) => ['reviews', 'insights', filters],
  },

  marketing: {
    all: () => ['marketing'],
    editor: (hostelId: string) => ['marketing', 'editor', hostelId],
    queue: () => ['marketing', 'queue'],
    submission: (revisionId: string) => ['marketing', 'submission', revisionId],
    kitchenMenu: (hostelId: string) => ['marketing', 'kitchen-menu', hostelId],
  },

  profile: {
    all: () => ['profile'],
    identity: () => ['profile', 'identity'],
    documents: () => ['profile', 'documents'],
    residencyHistory: () => ['profile', 'residency-history'],
    disclosures: () => ['profile', 'residency-history', 'disclosures'],
  },

  discover: {
    reviews: (slug: string) => ['discover', 'reviews', slug],
    all: () => ['discover'],
    search: (filters?: object) => ['discover', 'search', filters ?? {}],
    listing: (slug: string) => ['discover', 'listing', slug],
    saved: () => ['discover', 'saved'],
    enquiries: () => ['discover', 'enquiries'],
    enquiry: (id: string) => ['discover', 'enquiries', id],
  },
};
