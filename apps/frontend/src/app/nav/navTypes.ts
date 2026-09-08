import type { LucideIcon } from 'lucide-react';

/**
 * The shared shape the desktop shell (`AppConsoleShell`) renders. Owner and
 * Tenant each build their own `NavGroup[]` from these types (see `ownerNav.ts`
 * / `tenantNav.ts`), so the shell depends on a type, never on either config —
 * the same "one source of truth for the sidebar, tested" pattern as the admin
 * console's `adminNav.ts`.
 */
export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** 0 = no badge. */
  badge?: number;
  badgeTone?: 'amber' | 'accent' | 'red';
  /** Match this path exactly rather than as a prefix (for index routes like `/owner/home`). */
  end?: boolean;
}

export interface NavGroup {
  /** Small-caps heading above the items. Omitted for a single ungrouped list. */
  label?: string;
  items: NavItem[];
}

/**
 * Sidebar active-state matching, identical to `adminNav.ts`'s: an `end` item
 * lights only on an exact match; otherwise the item lights for its own path and
 * any child path. Pure — asserted in the nav config tests.
 */
export function isNavItemActive(itemPath: string, currentPath: string, end = false): boolean {
  if (end) return currentPath === itemPath;
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}
