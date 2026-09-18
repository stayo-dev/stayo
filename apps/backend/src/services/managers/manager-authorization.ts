/**
 * Server-side enforcement for the MANAGER role. ADMIN is always
 * unrestricted; MANAGER is scoped to whatever `manager_permission_grants`
 * and `manager_hostel_assignments` say *right now* — both are read fresh
 * from the DB per request, never trusted from the session/token or from
 * anything the client sends.
 *
 * Every platform-admin route a manager can reach must call
 * `requireAdminOrManagerPermission` (in place of the old admin-only
 * `requireAdmin`), and every hostel-scoped route must additionally call
 * `assertHostelAccess` with a hostelId resolved server-side — never an
 * optional one, per architectural-invariants-check.ts.
 */
import { prisma } from "@/lib/db";
import { HttpForbidden } from "@/src/services/platform-billing/subscription-http";
import type { ManagerPermission } from "@prisma/client";

export interface ManagerScope {
  managerProfileId: string;
  profileId: string;
  permissions: ManagerPermission[];
  hostelIds: string[];
}

async function loadManagerScope(profileId: string): Promise<ManagerScope | null> {
  const manager = await prisma.manager_profiles.findUnique({
    where: { profile_id: profileId },
    include: {
      permissions: { select: { permission: true } },
      hostel_assignments: { where: { unassigned_at: null }, select: { hostel_id: true } },
    },
  });
  if (!manager) return null;
  return {
    managerProfileId: manager.id,
    profileId: manager.profile_id,
    permissions: manager.permissions.map((p: { permission: ManagerPermission }) => p.permission),
    hostelIds: manager.hostel_assignments.map((h: { hostel_id: string }) => h.hostel_id),
  };
}

/**
 * Resolves the caller's manager scope, or `null` if the caller is not an
 * active manager (including ADMIN, who is unrestricted and never needs one).
 * Throws if a MANAGER-role session has no manager_profiles row or is
 * suspended — that combination should never happen (suspension already
 * revokes login via `profile.is_active`), so treat it as a hard failure
 * rather than silently degrading to "no access".
 */
export async function resolveManagerScope(session: any): Promise<ManagerScope | null> {
  if (!session || session.role !== "MANAGER") return null;
  const scope = await loadManagerScope(session.sub);
  if (!scope) throw new HttpForbidden("Manager account not found.");
  return scope;
}

/** ADMIN passes unconditionally. MANAGER must hold the specific grant. Anyone else is rejected. */
export async function requireAdminOrManagerPermission(
  session: any,
  permission: ManagerPermission,
): Promise<void> {
  if (!session) throw new HttpForbidden("Authentication required.");
  if (session.role === "ADMIN") return;
  if (session.role !== "MANAGER") throw new HttpForbidden("Admin access only.");
  const scope = await resolveManagerScope(session);
  if (!scope || !scope.permissions.includes(permission)) {
    throw new HttpForbidden(`Missing manager permission: ${permission}`);
  }
}

/**
 * ADMIN passes. MANAGER must have an active assignment for this exact
 * hostelId. `hostelId` is required (never optional) — the caller must
 * resolve it from the route/service, never fall back to "first hostel".
 */
export async function assertHostelAccess(session: any, hostelId: string): Promise<void> {
  if (!hostelId) throw new HttpForbidden("hostelId is required.");
  if (!session) throw new HttpForbidden("Authentication required.");
  if (session.role === "ADMIN") return;
  if (session.role !== "MANAGER") throw new HttpForbidden("Admin access only.");
  const scope = await resolveManagerScope(session);
  if (!scope || !scope.hostelIds.includes(hostelId)) {
    throw new HttpForbidden("Not assigned to this hostel.");
  }
}

/**
 * `null` for ADMIN means "unrestricted" — callers must treat null as "do not
 * filter", not as "empty list". For MANAGER, returns the (possibly empty)
 * array of currently-assigned hostel ids, safe to use directly in a Prisma
 * `id: { in: [...] }` filter.
 */
export async function scopeHostelIds(session: any): Promise<string[] | null> {
  if (!session) throw new HttpForbidden("Authentication required.");
  if (session.role === "ADMIN") return null;
  if (session.role !== "MANAGER") throw new HttpForbidden("Admin access only.");
  const scope = await resolveManagerScope(session);
  return scope ? scope.hostelIds : [];
}
