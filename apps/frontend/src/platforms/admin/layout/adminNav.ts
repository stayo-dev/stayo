import {
  LayoutGrid, TrendingUp, Users, ShieldCheck, Building2,
  BarChart3, Wallet, CreditCard, Bug, Megaphone, Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type AdminNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  badge: number;
  badgeTone: 'amber' | 'accent' | 'red';
  end?: boolean;
};

export type AdminNavGroup = { label: string; items: AdminNavItem[] };

export type AdminNavCounts = {
  leads?: number;
  kyc?: number;
  listings?: number;
  reports?: number;
};

/**
 * The sidebar, per the design's four groups (Manage / Review / Business /
 * Support).
 *
 * Settings is not in the design but is kept here deliberately — dropping it
 * would lose admin invites, notification templates and support-contact
 * editing with no replacement anywhere else in the console.
 */
export function buildAdminNav(counts: AdminNavCounts): AdminNavGroup[] {
  const item = (
    to: string,
    label: string,
    icon: LucideIcon,
    badge = 0,
    badgeTone: AdminNavItem['badgeTone'] = 'amber',
    end = false,
  ): AdminNavItem => ({ to, label, icon, badge: badge > 0 ? badge : 0, badgeTone, end });

  return [
    {
      label: 'Manage',
      items: [
        item('/admin', 'Overview', LayoutGrid, 0, 'amber', true),
        item('/admin/leads', 'Leads', TrendingUp, counts.leads ?? 0, 'amber'),
        item('/admin/owners', 'Owners', Users),
      ],
    },
    {
      label: 'Review',
      items: [
        item('/admin/kyc', 'KYC Approvals', ShieldCheck, counts.kyc ?? 0, 'amber'),
        item('/admin/listings', 'Hostel Listings', Building2, counts.listings ?? 0, 'accent'),
      ],
    },
    {
      label: 'Business',
      items: [
        item('/admin/revenue', 'Revenue & Analytics', BarChart3),
        item('/admin/settlements', 'Settlements', Wallet),
        item('/admin/subscriptions', 'Subscriptions', CreditCard),
      ],
    },
    {
      label: 'Support',
      items: [
        item('/admin/reports', 'Reports & Bugs', Bug, counts.reports ?? 0, 'red'),
        item('/admin/broadcasts', 'Broadcasts', Megaphone),
        item('/admin/settings', 'Settings', Settings),
      ],
    },
  ];
}

/**
 * Overview is matched exactly (`end`), otherwise it would stay lit on every
 * child route since every admin path starts with `/admin`.
 */
export function isNavItemActive(itemPath: string, currentPath: string, end = false): boolean {
  if (end) return currentPath === itemPath;
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}
