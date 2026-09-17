import { tintForId } from '../theme/palette';

/**
 * Shapes `/platform-admin/managers` rows for the console's managers table.
 *
 * PURE MODULE — no I/O, runs under vitest's node environment.
 */

export const MANAGER_PERMISSIONS = [
  'MANAGE_LEADS',
  'MANAGE_OWNERS',
  'MANAGE_HOSTELS',
  'MANAGE_ONBOARDING',
  'VIEW_REVENUE_ANALYTICS',
  'MANAGE_SUBSCRIPTIONS',
  'SUPPORT_REPORTS_BUGS',
  'MANAGE_BROADCASTS',
  'MANAGE_SETTINGS',
] as const;

export type ManagerPermission = (typeof MANAGER_PERMISSIONS)[number];

export const PERMISSION_GROUPS: { label: string; permissions: ManagerPermission[] }[] = [
  { label: 'Manage', permissions: ['MANAGE_LEADS', 'MANAGE_OWNERS', 'MANAGE_HOSTELS', 'MANAGE_ONBOARDING'] },
  { label: 'Business', permissions: ['VIEW_REVENUE_ANALYTICS', 'MANAGE_SUBSCRIPTIONS'] },
  { label: 'Support', permissions: ['SUPPORT_REPORTS_BUGS', 'MANAGE_BROADCASTS'] },
  { label: 'System', permissions: ['MANAGE_SETTINGS'] },
];

export const PERMISSION_LABEL: Record<ManagerPermission, string> = {
  MANAGE_LEADS: 'Leads',
  MANAGE_OWNERS: 'Owners',
  MANAGE_HOSTELS: 'Hostels',
  MANAGE_ONBOARDING: 'Onboarding',
  VIEW_REVENUE_ANALYTICS: 'Revenue & Analytics',
  MANAGE_SUBSCRIPTIONS: 'Subscriptions',
  SUPPORT_REPORTS_BUGS: 'Reports & Bugs',
  MANAGE_BROADCASTS: 'Broadcasts',
  MANAGE_SETTINGS: 'Settings',
};

export type ManagerStatus = 'PENDING_INVITATION' | 'ACTIVE' | 'SUSPENDED';

export const STATUS_LABEL: Record<ManagerStatus, string> = {
  PENDING_INVITATION: 'Pending invitation',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
};

export const STATUS_TONE: Record<ManagerStatus, 'green' | 'amber' | 'red'> = {
  ACTIVE: 'green',
  PENDING_INVITATION: 'amber',
  SUSPENDED: 'red',
};

export type ManagerRow = {
  id: string;
  profileId: string;
  name: string;
  email: string;
  phone: string;
  status: ManagerStatus;
  permissions: ManagerPermission[];
  hostelCount: number;
  hostelIds: string[];
  initials: string;
  tint: string;
};

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function toManagerRows(apiManagers: any[]): ManagerRow[] {
  return (apiManagers ?? []).map((m) => {
    const name = String(m.profile?.name ?? 'Unnamed manager');
    const assignments = m.hostel_assignments ?? [];
    return {
      id: String(m.id),
      profileId: String(m.profile_id ?? m.profile?.id ?? ''),
      name,
      email: String(m.profile?.email ?? ''),
      phone: String(m.profile?.phone ?? ''),
      status: (m.status ?? 'PENDING_INVITATION') as ManagerStatus,
      permissions: (m.permissions ?? []).map((p: any) => p.permission as ManagerPermission),
      hostelCount: assignments.length,
      hostelIds: assignments.map((a: any) => String(a.hostel_id)),
      initials: initialsOf(name),
      tint: tintForId(String(m.id)),
    };
  });
}

export function managerStats(rows: ManagerRow[]): { label: string; value: string; sub: string }[] {
  const active = rows.filter((r) => r.status === 'ACTIVE').length;
  const pending = rows.filter((r) => r.status === 'PENDING_INVITATION').length;
  const hostels = rows.reduce((sum, r) => sum + r.hostelCount, 0);
  return [
    { label: 'Total managers', value: String(rows.length), sub: 'on this page' },
    { label: 'Active', value: String(active), sub: 'can sign in now' },
    { label: 'Pending invitation', value: String(pending), sub: 'not yet activated' },
    { label: 'Hostels assigned', value: String(hostels), sub: 'across all managers' },
  ];
}
