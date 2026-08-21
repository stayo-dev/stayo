import { CircleUserRound, Compass, DoorOpen, Home, User, UtensilsCrossed, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface AppNavTab {
  to: string;
  label: string;
  Icon: LucideIcon;
  end?: boolean;
  /**
   * When set, tapping this tab performs an action instead of navigating.
   *
   * "Log in" is the only one: it used to route to `/profile`, which for a
   * signed-out visitor is a page whose entire content is a second button that
   * opens the sign-in sheet. Two taps, one intent, and a page-load in between
   * — the person had already told us what they wanted by tapping Log in.
   */
  action?: 'SIGN_IN';
}

/**
 * The two tab sets the one app-wide bottom nav can show, keyed by whether
 * the signed-in user (or a signed-out visitor) has a live tenancy. See
 * `useAppNav` for how "live" is decided — this file is pure data, no auth
 * logic, so `AppBottomNav` (the only nav implementation — there is no inner
 * Dashboard strip) reads one definition.
 */
export const EXPLORE_PROFILE_TABS: AppNavTab[] = [
  { to: '/discover', label: 'Explore', Icon: Compass, end: true },
  { to: '/profile', label: 'Profile', Icon: User, end: false },
];

/**
 * The single-level active-tenant nav — Home | Room | Food | Payments |
 * Profile | Explore, all six in one primary bar. Supersedes the old
 * Explore/Dashboard/Profile outer bar + Home/Money/Room/Food/Complaints
 * inner strip split (ADR-078): there is no "Dashboard" item and no second
 * nav layer anymore. Complaints is deliberately not here — it stays the
 * tenant → owner system, reachable contextually from Room instead of as a
 * primary tab (see `TenantComplaintsPage`).
 */
export const ACTIVE_TENANT_TABS: AppNavTab[] = [
  { to: '/tenant/home', label: 'Home', Icon: Home, end: false },
  { to: '/tenant/room', label: 'Room', Icon: DoorOpen, end: false },
  { to: '/tenant/food', label: 'Food', Icon: UtensilsCrossed, end: false },
  { to: '/tenant/money', label: 'Payments', Icon: Wallet, end: false },
  { to: '/profile', label: 'Profile', Icon: User, end: false },
  { to: '/discover', label: 'Explore', Icon: Compass, end: true },
];

/** A tenancy is "live" for nav purposes if it hasn't ended or fallen through. */
export const LIVE_TENANCY_STATUSES = new Set(['INVITED', 'ACTIVE']);


/**
 * The outer bar, with the account tab named for what the person actually has.
 *
 * A first-time seeker arrives on Discovery with no account at all, so
 * labelling that tab "Profile" advertises something that does not exist yet
 * and reads as though they have one. It becomes "Profile" the moment they do.
 *
 * The destination stays `/profile` in both states: that page already handles
 * the signed-out case, and moving the route under someone would break links.
 *
 * The icon is a **person**, not lucide's `LogIn` arrow-into-door. That arrow
 * is the same glyph almost every app uses for *sign out*, so on a nav bar it
 * read as "leave" to people who had never signed in at all. A person avatar
 * is what every marketplace (Airbnb included) puts on this control, and it
 * stays coherent with the signed-in `User` icon beside it.
 *
 * PURE — runs under vitest's node environment.
 */
export function buildOuterTabs(
  { signedIn, liveTenancy }: { signedIn: boolean; liveTenancy: boolean },
): AppNavTab[] {
  // A live tenancy implies a signed-in account, so that bar is never relabelled.
  if (liveTenancy) return ACTIVE_TENANT_TABS;
  if (signedIn) return EXPLORE_PROFILE_TABS;

  return EXPLORE_PROFILE_TABS.map((tab) =>
    tab.to === '/profile'
      ? { ...tab, label: 'Log in', Icon: CircleUserRound, action: 'SIGN_IN' as const }
      : tab,
  );
}
