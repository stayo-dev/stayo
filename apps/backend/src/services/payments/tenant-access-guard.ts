/**
 * 🛂 Tenant Access Guard
 *
 * Shared "tenant may act on their own record; owner/admin may act on their
 * own tenants" authorization check. Extracted from the byte-identical block
 * duplicated in the settlement-preview (GET) and settlement-plan (POST)
 * routes. Behavior is unchanged — same lookup, same error conditions.
 */

import { prisma } from "@/lib/db";

export interface SessionUser {
  id: string;
  role: string;
  owner_id?: string | null;
}

export interface TenantAccessResult {
  tenant: {
    id: string;
    owner_id: string | null;
    hostel_id: string | null;
    profile_id: string | null;
  };
  effectiveHostelId: string;
}

/**
 * Verify the acting user may operate on `tenantId`, optionally scoped to
 * `hostelId`. Throws `NOT_FOUND:` / `FORBIDDEN:` / `HOSTEL_ACCESS_DENIED:` /
 * `HOSTEL_CONTEXT_REQUIRED:`-prefixed errors matching the conventions the
 * calling routes already map to HTTP responses.
 *
 * `enforceHostelMatch` (default true) exists because the two original call
 * sites this was extracted from are NOT byte-identical here:
 * settlement-preview rejects a mismatched hostelId for OWNER/ADMIN;
 * settlement-plan never checked it (effectiveHostelId is trusted from the
 * request body as-is). Pass `false` to reproduce settlement-plan's original,
 * looser behavior exactly.
 */
export async function resolveTenantSettlementAccess(
  user: SessionUser,
  params: { tenantId: string; hostelId?: string | null; enforceHostelMatch?: boolean }
): Promise<TenantAccessResult> {
  const { tenantId, hostelId, enforceHostelMatch = true } = params;

  const isTenant = user.role === "TENANT";
  const isOwnerOrAdmin = user.role === "OWNER" || user.role === "ADMIN";

  const tenant = await prisma.tenants.findUnique({
    where: { id: tenantId },
    select: { id: true, owner_id: true, hostel_id: true, profile_id: true },
  });
  if (!tenant) throw new Error("NOT_FOUND: Tenant not found");

  if (isTenant && tenant.profile_id !== user.id) {
    throw new Error("FORBIDDEN: You can only act on your own tenant record");
  }
  if (isOwnerOrAdmin) {
    const effectiveOwnerId = user.owner_id || user.id;
    if (tenant.owner_id !== effectiveOwnerId) {
      throw new Error("FORBIDDEN: Tenant does not belong to you");
    }
    if (enforceHostelMatch && hostelId && tenant.hostel_id !== hostelId) {
      throw new Error("HOSTEL_ACCESS_DENIED: Tenant does not belong to this hostel");
    }
  }

  const effectiveHostelId = hostelId || tenant.hostel_id;
  if (!effectiveHostelId) {
    throw new Error("HOSTEL_CONTEXT_REQUIRED: Cannot determine hostel context");
  }

  return { tenant, effectiveHostelId };
}
