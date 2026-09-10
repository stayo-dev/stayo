import { Home, DoorOpen, UtensilsCrossed, Wallet, User } from 'lucide-react';
import type { NavGroup } from './navTypes';

export { isNavItemActive } from './navTypes';

/**
 * The tenant desktop sidebar — exactly `ACTIVE_TENANT_TABS` from
 * `app/nav/appNavConfig.ts` (Home / Room / Food / Payments / Profile), reusing
 * the same icons so the desktop sidebar and the mobile `AppBottomNav` can never
 * disagree about which five destinations a live tenant has.
 *
 * No hostel switcher (one tenancy). EXITING/EXITED tenancy states are handled
 * by `ProtectedTenantRoute` / the `ExitingBanner` exactly as today — the sidebar
 * does not change shape for them.
 */
export function buildTenantNav(): NavGroup[] {
  return [
    {
      items: [
        { to: '/tenant/home', label: 'Home', icon: Home, end: true },
        { to: '/tenant/room', label: 'Room', icon: DoorOpen },
        { to: '/tenant/food', label: 'Food', icon: UtensilsCrossed },
        { to: '/tenant/money', label: 'Payments', icon: Wallet },
        { to: '/profile', label: 'Profile', icon: User },
      ],
    },
  ];
}
