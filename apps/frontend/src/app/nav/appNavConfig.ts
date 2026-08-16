import { Compass, DoorOpen, Home, User, UtensilsCrossed, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface AppNavTab {
  to: string;
  label: string;
  Icon: LucideIcon;
  end?: boolean;
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
 * The single-level active-tenant nav — Home | Payments | Food | Room |
 * Profile | Explore, all six in one primary bar. Supersedes the old
 * Explore/Dashboard/Profile outer bar + Home/Money/Room/Food/Complaints
 * inner strip split (ADR-078): there is no "Dashboard" item and no second
 * nav layer anymore. Complaints is deliberately not here — it stays the
 * tenant → owner system, reachable contextually from Room instead of as a
 * primary tab (see `TenantComplaintsPage`).
 */
export const ACTIVE_TENANT_TABS: AppNavTab[] = [
  { to: '/tenant/home', label: 'Home', Icon: Home, end: false },
  { to: '/tenant/money', label: 'Payments', Icon: Wallet, end: false },
  { to: '/tenant/food', label: 'Food', Icon: UtensilsCrossed, end: false },
  { to: '/tenant/room', label: 'Room', Icon: DoorOpen, end: false },
  { to: '/profile', label: 'Profile', Icon: User, end: false },
  { to: '/discover', label: 'Explore', Icon: Compass, end: true },
];

/** A tenancy is "live" for nav purposes if it hasn't ended or fallen through. */
export const LIVE_TENANCY_STATUSES = new Set(['INVITED', 'ACTIVE']);
