/**
 * Pure formatting for the Super Admin activity feed
 * (`GET /api/platform-admin/activity`). No I/O — runs under vitest's node
 * environment.
 */

const ACTION_LABEL: Record<string, string> = {
  HOSTEL_UPDATED: 'Updated hostel details',
  HOSTEL_APPROVED: 'Approved hostel listing',
  HOSTEL_ASSIGNED: 'Assigned hostel',
  HOSTEL_UNASSIGNED: 'Unassigned hostel',
  HOSTEL_REASSIGNED: 'Reassigned hostel',
  MANAGER_UPDATED: 'Updated manager',
  OWNER_UPDATED: 'Updated owner details',
  OWNER_CONTACTED: 'Contacted owner',
  ONBOARDING_STEP_COMPLETED: 'Completed onboarding step',
  SUPPORT_REQUEST_RESOLVED: 'Resolved support request',
  CONFIG_CHANGED: 'Changed configuration',
};

export function describeAction(actionType: string): string {
  return ACTION_LABEL[actionType] ?? actionType.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

export type ChangedField = { field: string; from: unknown; to: unknown };

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** "Monthly Rent: ₹6,500 → ₹7,000" style, one line per changed field. */
export function describeChangedFields(changed: ChangedField[] | undefined | null): string[] {
  if (!changed || changed.length === 0) return [];
  return changed.map((c) => `${c.field}: ${formatValue(c.from)} → ${formatValue(c.to)}`);
}

export function formatActivityTimestamp(iso: string): { time: string; date: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { time: '—', date: '—' };
  return {
    time: d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }),
    date: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
  };
}

export type ActivityEntry = {
  id: string;
  actionType: string;
  entityType: string;
  hostelId: string | null;
  actorName: string | null;
  actorRole: string | null;
  metadata: any;
  timestamp: string;
};

export type ActivityFilters = {
  managerId?: string;
  hostelId?: string;
  actionType?: string;
  entityType?: string;
  from?: string;
  to?: string;
};

/** Drops empty-string filter values so the API wrapper never sends `?actionType=`. */
export function cleanActivityFilters(filters: ActivityFilters): ActivityFilters {
  const cleaned: ActivityFilters = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value) (cleaned as any)[key] = value;
  }
  return cleaned;
}
