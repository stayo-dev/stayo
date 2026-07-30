import { prisma } from "../db";
import { eventLog } from "../services/event-log-service";

import type { AuthPayload } from "../auth-edge";

export type OperationalScope = {
  owner_id: string;
  hostel_id?: string | null;
};

export function scopedTenantWhere(scope: OperationalScope, extra: Record<string, any> = {}) {
  return {
    owner_id: scope.owner_id,
    ...(scope.hostel_id ? { hostel_id: scope.hostel_id } : {}),
    ...extra,
  };
}

export function scopedRoomWhere(scope: OperationalScope, extra: Record<string, any> = {}) {
  return {
    hostels: { owner_id: scope.owner_id },
    ...(scope.hostel_id ? { hostel_id: scope.hostel_id } : {}),
    ...extra,
  };
}

export function scopedPaymentWhere(scope: OperationalScope, extra: Record<string, any> = {}) {
  return {
    owner_id: scope.owner_id,
    ...(scope.hostel_id ? { hostel_id: scope.hostel_id } : {}),
    ...extra,
  };
}

export function scopedObligationWhere(scope: OperationalScope, extra: Record<string, any> = {}) {
  return {
    owner_id: scope.owner_id,
    ...(scope.hostel_id ? { hostel_id: scope.hostel_id } : {}),
    ...extra,
  };
}

export function scopedExpenseWhere(scope: OperationalScope, extra: Record<string, any> = {}) {
  return {
    owner_id: scope.owner_id,
    ...(scope.hostel_id ? { hostel_id: scope.hostel_id } : {}),
    ...extra,
  };
}

export async function assertHostelBelongsToOwner(ownerId: string, hostelId?: string | null) {
  if (!hostelId) return null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hostelId);
  if (!isUuid) {
    const err: any = new Error("FORBIDDEN: Invalid hostel identifier");
    err.code = "FORBIDDEN";
    throw err;
  }
  const hostel = await prisma.hostels.findFirst({
    where: { id: hostelId, owner_id: ownerId, status: { in: ["ACTIVE", "INACTIVE", "ARCHIVED"] } },
    select: { id: true, owner_id: true, status: true },
  });
  if (!hostel) {
    await eventLog.log("HOSTEL_SCOPE_VIOLATION", ownerId, { hostel_id: hostelId });
    const err: any = new Error("FORBIDDEN: Hostel is not owned by the authenticated owner");
    err.code = "FORBIDDEN";
    throw err;
  }
  return hostel;
}

export async function requireHostelBelongsToOwner(ownerId: string, hostelId?: string | null) {
  if (!hostelId) {
    const err: any = new Error("HOSTEL_CONTEXT_REQUIRED: hostelId is required for operational requests");
    err.code = "HOSTEL_CONTEXT_REQUIRED";
    throw err;
  }
  return assertHostelBelongsToOwner(ownerId, hostelId);
}

export async function resolveOwnerOrAdminScopeForHostel(session: AuthPayload | null, hostelId?: string | null): Promise<string> {
  if (!session) {
    const err: any = new Error("UNAUTHORIZED: Authentication required");
    err.code = "UNAUTHORIZED";
    throw err;
  }

  const isUuid = hostelId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hostelId);
  const cleanHostelId = isUuid ? hostelId : null;

  if (session.role === "OWNER") {
    if (!session.owner_id) {
      const err: any = new Error("UNAUTHORIZED: OWNER token missing owner_id");
      err.code = "UNAUTHORIZED";
      throw err;
    }
    if (session.owner_id !== session.sub) {
      const err: any = new Error("UNAUTHORIZED: OWNER token owner_id mismatch");
      err.code = "UNAUTHORIZED";
      throw err;
    }
    if (cleanHostelId) {
      await requireHostelBelongsToOwner(session.owner_id, cleanHostelId);
    }
    return session.owner_id;
  }

  const err: any = new Error("FORBIDDEN: Owner access required");
  err.code = "FORBIDDEN";
  throw err;
}

export async function resolveHostelContext(
  session: AuthPayload | null,
  hostelId?: string | null
): Promise<{ ownerId: string; hostelId: string }> {
  if (!session) {
    const err: any = new Error("UNAUTHORIZED: Authentication required");
    err.code = "UNAUTHORIZED";
    throw err;
  }

  let ownerId: string;
  if (session.role === "OWNER") {
    if (!session.owner_id) {
      const err: any = new Error("UNAUTHORIZED: OWNER token missing owner_id");
      err.code = "UNAUTHORIZED";
      throw err;
    }
    if (session.owner_id !== session.sub) {
      const err: any = new Error("UNAUTHORIZED: OWNER token owner_id mismatch");
      err.code = "UNAUTHORIZED";
      throw err;
    }
    ownerId = session.owner_id;
  } else {
    const err: any = new Error("FORBIDDEN: Owner access required");
    err.code = "FORBIDDEN";
    throw err;
  }

  let resolvedHostelId: string | null = null;
  const isUuid = hostelId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hostelId);
  
  if (isUuid) {
    resolvedHostelId = hostelId!;
    await requireHostelBelongsToOwner(ownerId, resolvedHostelId);
  } else {
    const firstHostel = await prisma.hostels.findFirst({
      where: { owner_id: ownerId, status: { in: ["ACTIVE", "INACTIVE"] } },
      select: { id: true }
    });
    if (!firstHostel) {
      const err: any = new Error("HOSTEL_NOT_FOUND: No active hostels found for this owner");
      err.code = "HOSTEL_NOT_FOUND";
      throw err;
    }
    resolvedHostelId = firstHostel.id;
  }

  return { ownerId, hostelId: resolvedHostelId };
}

export async function assertTenantBelongsToOwner(tenantId: string, ownerId: string) {
  const tenant = await prisma.tenants.findFirst({
    where: { id: tenantId, owner_id: ownerId },
    select: { id: true, owner_id: true, hostel_id: true },
  });
  if (!tenant) {
    await eventLog.log("OWNER_SCOPE_VIOLATION", ownerId, { entity_type: "Tenant", entity_id: tenantId });
    const err: any = new Error("FORBIDDEN: Tenant is not owned by the authenticated owner");
    err.code = "FORBIDDEN";
    throw err;
  }
  return tenant;
}
