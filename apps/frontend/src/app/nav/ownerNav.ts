import { Home, Users, Wallet, UtensilsCrossed, Building2, Settings } from 'lucide-react';
import type { NavGroup } from './navTypes';

export { isNavItemActive } from './navTypes';

/**
 * The owner desktop sidebar — the mobile bottom nav's five tabs
 * (Home / Tenants / Money / Food / Hostels, see `OwnerAppShell`) plus Settings,
 * which on mobile hides behind the Home avatar (`/owner/more`) and on desktop
 * earns a permanent slot.
 *
 * A single ungrouped list, matching the design's owner shell (unlike the admin
 * console's four labelled groups). Icons match `OwnerAppShell`'s `ownerTabs()`
 * so the two navs can't drift.
 *
 * Badge counts are wired in Phase 1 from the existing owner-dashboard / alerts
 * queries; this phase they default to 0 (no badge).
 */
export interface OwnerNavCounts {
  /** Rent-collection work waiting — the Home "Collect Rent" hero's count. */
  collect?: number;
  /** Unread alerts — the Home bell's badge. */
  alerts?: number;
}

export function buildOwnerNav(counts: OwnerNavCounts = {}): NavGroup[] {
  return [
    {
      items: [
        { to: '/owner/home', label: 'Home', icon: Home, end: true },
        { to: '/owner/tenants', label: 'Tenants', icon: Users },
        {
          to: '/owner/money',
          label: 'Money',
          icon: Wallet,
          badge: counts.collect && counts.collect > 0 ? counts.collect : 0,
          badgeTone: 'accent',
        },
        { to: '/owner/food', label: 'Food', icon: UtensilsCrossed },
        { to: '/owner/hostels', label: 'Hostels', icon: Building2 },
        {
          to: '/owner/more',
          label: 'Settings',
          icon: Settings,
          badge: counts.alerts && counts.alerts > 0 ? counts.alerts : 0,
          badgeTone: 'amber',
        },
      ],
    },
  ];
}
