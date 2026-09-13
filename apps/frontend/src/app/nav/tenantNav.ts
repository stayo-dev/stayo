import { Home, DoorOpen, UtensilsCrossed, Wallet, User, Compass } from 'lucide-react';
import type { NavGroup } from './navTypes';

export { isNavItemActive } from './navTypes';

/**
 * The tenant desktop sidebar — exactly `ACTIVE_TENANT_TABS` from
 * `app/nav/appNavConfig.ts` (Home / Room / Food / Payments / Profile /
 * Explore), reusing the same icons so the desktop sidebar and the mobile
 * `AppBottomNav` can never disagree about which six destinations a live tenant
 * has. `tenantNav.test.ts` asserts that equality, which is what caught this
 * list still holding five when Explore came back with the marketplace — the
 * duplication is deliberate (the two differ on `end`) but it is checked.
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
        /* Not `end`, unlike the mobile tab: in a persistent sidebar the
           Explore item should stay lit while the person is anywhere under
           /discover (search, a listing, an enquiry), not only on its index. */
        { to: '/discover', label: 'Explore', icon: Compass },
      ],
    },
  ];
}
