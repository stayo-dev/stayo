import {
  LayoutGrid, TrendingUp, Users, UserCog, Activity, ListChecks,
  BarChart3, CreditCard, Bug, Megaphone, Settings, Star, Building2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { hasManagerPermission } from '../managers/permissions';
import type { ManagerPermission } from '../managers/managerRows';

export type AdminNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  badge: number;
  badgeTone: 'amber' | 'accent' | 'red';
  end?: boolean;
  /** Gates this item to a manager holding this permission (ADMIN always sees it). Omit for items every signed-in console user should see. */
  permission?: ManagerPermission;
  /** Super Admin only — never shown to a MANAGER session, regardless of their permissions. */
  adminOnly?: boolean;
};

export type AdminNavGroup = { label: string; items: AdminNavItem[] };

export type AdminNavCounts = {
  leads?: number;
  listings?: number;
  /** Reviews waiting to be published — nothing reaches a listing without this. */
  reviews?: number;
  reports?: number;
};

/**
 * The sidebar, per the design's four groups (Manage / Review / Business /
 * Support), plus Managers/Activity (ADR-214, Super Admin only) and
 * Onboarding (manager-visible under MANAGE_ONBOARDING).
 *
 * `role`/`permissions` filter what renders — **UX only**. Every route these
 * items link to independently re-checks the same permission server-side
 * (`requireAdminOrManagerPermission`), so this filter existing or not changes
 * nothing about what data a manager can actually reach; it only changes
 * whether they see a dead end.
 *
 * Settings is not in the design but is kept here deliberately — dropping it
 * would lose admin invites, notification templates and support-contact
 * editing with no replacement anywhere else in the console.
 */
export function buildAdminNav(counts: AdminNavCounts, role?: string, permissions?: string[]): AdminNavGroup[] {
  const item = (
    to: string,
    label: string,
    icon: LucideIcon,
    badge = 0,
    badgeTone: AdminNavItem['badgeTone'] = 'amber',
    end = false,
    extra: Partial<Pick<AdminNavItem, 'permission' | 'adminOnly'>> = {},
  ): AdminNavItem => ({ to, label, icon, badge: badge > 0 ? badge : 0, badgeTone, end, ...extra });

  const groups: AdminNavGroup[] = [
    {
      label: 'Manage',
      items: [
        item('/admin', 'Overview', LayoutGrid, 0, 'amber', true),
        item('/admin/leads', 'Leads', TrendingUp, counts.leads ?? 0, 'amber', false, { permission: 'MANAGE_LEADS' }),
        item('/admin/owners', 'Owners', Users, 0, 'amber', false, { permission: 'MANAGE_OWNERS' }),
        item('/admin/onboarding', 'Onboarding', ListChecks, 0, 'amber', false, { permission: 'MANAGE_ONBOARDING' }),
        item('/admin/managers', 'Managers', UserCog, 0, 'amber', false, { adminOnly: true }),
        item('/admin/activity', 'Activity', Activity, 0, 'amber', false, { adminOnly: true }),
      ],
    },
    {
      label: 'Review',
      items: [
        // 'KYC Approvals' removed from the console entirely.
        item('/admin/listings', 'Hostel Listings', Building2, counts.listings ?? 0, 'accent', false, { permission: 'MANAGE_HOSTELS' }),
        item('/admin/reviews', 'Reviews', Star, counts.reviews ?? 0, 'amber', false, { permission: 'MANAGE_HOSTELS' }),
      ],
    },
    {
      label: 'Business',
      items: [
        item('/admin/revenue', 'Revenue & Analytics', BarChart3, 0, 'amber', false, { permission: 'VIEW_REVENUE_ANALYTICS' }),
        item('/admin/subscriptions', 'Subscriptions', CreditCard, 0, 'amber', false, { permission: 'MANAGE_SUBSCRIPTIONS' }),
      ],
    },
    {
      label: 'Support',
      items: [
        item('/admin/reports', 'Reports & Bugs', Bug, counts.reports ?? 0, 'red', false, { permission: 'SUPPORT_REPORTS_BUGS' }),
        item('/admin/broadcasts', 'Broadcasts', Megaphone, 0, 'amber', false, { permission: 'MANAGE_BROADCASTS' }),
        item('/admin/settings', 'Settings', Settings, 0, 'amber', false, { permission: 'MANAGE_SETTINGS' }),
      ],
    },
  ];

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((navItem) => {
        if (navItem.adminOnly) return role?.toLowerCase() === 'admin';
        if (!navItem.permission) return true;
        return hasManagerPermission(role, permissions, navItem.permission);
      }),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * Overview is matched exactly (`end`), otherwise it would stay lit on every
 * child route since every admin path starts with `/admin`.
 */
export function isNavItemActive(itemPath: string, currentPath: string, end = false): boolean {
  if (end) return currentPath === itemPath;
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}
