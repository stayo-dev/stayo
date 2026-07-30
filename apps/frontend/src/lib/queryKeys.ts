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
    pendingDocuments: () => ownerKey('pending-documents'),
    renewalQueue: () => ownerKey('renewal-queue'),
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
};
