import type { AuthUser } from '@context/AuthContext';
import type { ManagerPermission } from './managerRows';

/**
 * UX-only permission gating — decides what the console *renders*, never what
 * it *allows*. Every route the console calls re-checks the same grant
 * server-side (`requireAdminOrManagerPermission`), so a bug or a stale value
 * here can only ever hide a button the backend would reject anyway, never
 * expose one it wouldn't.
 *
 * PURE — the exported predicate takes plain values, not the hook, so it's
 * testable without React.
 */
export function hasManagerPermission(
  role: string | undefined,
  permissions: string[] | undefined,
  permission: ManagerPermission,
): boolean {
  const normalized = role?.toLowerCase();
  if (normalized === 'admin') return true;
  if (normalized !== 'manager') return false;
  return (permissions ?? []).includes(permission);
}

export function isAdminRole(role: string | undefined): boolean {
  return role?.toLowerCase() === 'admin';
}

export function isManagerRole(role: string | undefined): boolean {
  return role?.toLowerCase() === 'manager';
}

export function userHasPermission(user: Pick<AuthUser, 'role' | 'manager_permissions'> | null, permission: ManagerPermission): boolean {
  return hasManagerPermission(user?.role, user?.manager_permissions, permission);
}
