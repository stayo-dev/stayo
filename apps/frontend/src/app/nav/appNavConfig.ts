import { Compass, DoorOpen, Home, LayoutDashboard, MessageSquareWarning, User, UtensilsCrossed, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface AppNavTab {
  to: string;
  label: string;
  Icon: LucideIcon;
  end?: boolean;
}

/**
 * The two outer tab sets the app-wide bottom nav can show, keyed by whether
 * the signed-in user (or a signed-out visitor) has a live tenancy. See
 * `useAppNav` for how "live" is decided — this file is pure data, no auth
 * logic, so both `AppBottomNav` and any future consumer read one definition.
 */
export const EXPLORE_PROFILE_TABS: AppNavTab[] = [
  { to: '/discover', label: 'Explore', Icon: Compass, end: true },
  { to: '/profile', label: 'Profile', Icon: User, end: false },
];

export const EXPLORE_DASHBOARD_PROFILE_TABS: AppNavTab[] = [
  { to: '/discover', label: 'Explore', Icon: Compass, end: true },
  { to: '/tenant/home', label: 'Dashboard', Icon: LayoutDashboard, end: false },
  { to: '/profile', label: 'Profile', Icon: User, end: false },
];

/**
 * The Tenant Dashboard's own inner tab strip, shown only inside `/tenant/*`,
 * below the outer bar. Complaints replaces the dashboard's old Profile tab
 * (ADR-078 supersedes ADR-068's "no Complaints tab" call) — Profile is now
 * one of the outer tabs above, shared app-wide.
 */
export const DASHBOARD_TABS: AppNavTab[] = [
  { to: '/tenant/home', label: 'Home', Icon: Home, end: false },
  { to: '/tenant/money', label: 'Money', Icon: Wallet, end: false },
  { to: '/tenant/room', label: 'Room', Icon: DoorOpen, end: false },
  { to: '/tenant/food', label: 'Food', Icon: UtensilsCrossed, end: false },
  { to: '/tenant/complaints', label: 'Complaints', Icon: MessageSquareWarning, end: false },
];

/** A tenancy is "live" for nav purposes if it hasn't ended or fallen through. */
export const LIVE_TENANCY_STATUSES = new Set(['INVITED', 'ACTIVE']);
