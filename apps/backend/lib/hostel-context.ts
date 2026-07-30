/**
 * 🏗️ Hostel Operational Context — SINGLE SOURCE OF TRUTH (v2)
 *
 * Replaces implicit owner-level preference lookup with an explicitly hostel-scoped
 * context object. All operational services (reminders, receipts, rent generation,
 * payments) MUST use this module when they need hostel-level config.
 *
 * ARCHITECTURE RULE:
 *   `findFirst({ where: { owner_id } })` is BANNED for operational hostel resolution.
 *   All calls must resolve an explicit hostelId from the entity chain first.
 *
 * BACKWARD COMPATIBILITY:
 *   Legacy consumers may still call resolvePreferences(hostel), but the hostel
 *   record must already be selected by explicit context or entity lineage.
 */

import { prisma } from "./db";
import { resolvePreferences, type HostelPreferences } from "./preferences";
import { eventLog } from "./services/event-log-service";

// ─── Hostel Operational Context ────────────────────────────────────────────────

export interface HostelOperationalContext {
  /** The resolved hostel record */
  hostel: {
    id: string;
    owner_id: string;
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    phone: string | null;
    gst_number: string | null;
    upi_id: string | null;
    logo_url: string | null;
    receipt_prefix: string | null;
    timezone: string | null;
    currency: string | null;
    status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
    is_active: boolean;
  };
  /** Fully resolved preferences for this hostel (typed, defaulted) */
  prefs: HostelPreferences;
}

/**
 * Primary entry point for any service needing hostel-scoped operational config.
 *
 * Validates that:
 * - hostelId is provided (rejects implicit resolution)
 * - hostel exists and is active
 * - hostel belongs to the given owner (prevents cross-owner access)
 *
 * Throws structured errors — callers should handle:
 *   HOSTEL_CONTEXT_REQUIRED  — hostelId was not provided
 *   HOSTEL_NOT_FOUND         — hostel doesn't exist or is inactive
 *   HOSTEL_ACCESS_DENIED     — hostel does not belong to this owner
 */
export async function getHostelOperationalContext(
  ownerId: string,
  hostelId: string,
  options?: { allowArchived?: boolean },
): Promise<HostelOperationalContext> {
  if (!hostelId) {
    const err: any = new Error(
      "HOSTEL_CONTEXT_REQUIRED: hostelId must be provided explicitly. " +
      "Implicit hostel resolution via findFirst(owner_id) is prohibited. " +
      "Resolve hostelId from the entity chain (tenant→allocation→room→hostel) first."
    );
    err.code = "HOSTEL_CONTEXT_REQUIRED";
    throw err;
  }

  const hostel = await prisma.hostels.findUnique({
    where: { id: hostelId },
    select: {
      id: true,
      owner_id: true,
      name: true,
      address: true,
      city: true,
      state: true,
      pincode: true,
      phone: true,
      gst_number: true,
      upi_id: true,
      logo_url: true,
      receipt_prefix: true,
      timezone: true,
      currency: true,
      status: true,
      is_active: true,
      // Preferences blob + typed columns needed for resolvePreferences
      preferences_config: true,
      rent_cycle: true,
      auto_rent_day: true,
    },
  });

  if (!hostel || (hostel.status === "ARCHIVED" && !options?.allowArchived)) {
    const err: any = new Error(`HOSTEL_NOT_FOUND: Hostel ${hostelId} does not exist or is archived.`);
    err.code = "HOSTEL_NOT_FOUND";
    throw err;
  }

  if (hostel.owner_id !== ownerId) {
    const err: any = new Error(`HOSTEL_ACCESS_DENIED: Hostel ${hostelId} does not belong to owner ${ownerId}.`);
    err.code = "HOSTEL_ACCESS_DENIED";
    throw err;
  }

  return {
    hostel: {
      ...hostel,
      is_active: hostel.status === "ACTIVE",
    } as HostelOperationalContext["hostel"],
    prefs: resolvePreferences(hostel),
  };
}

/**
 * Resolve hostelId from a tenant's current active room allocation.
 *
 * Use this when you have a tenantId but no hostelId.
 * Returns null if the tenant has no active allocation (e.g. just invited).
 *
 * Entity chain: tenant → room_allocation (is_active=true) → room → hostel
 */
export async function resolveHostelIdFromTenant(tenantId: string): Promise<string | null> {
  const allocation = await prisma.roomAllocation.findFirst({
    where: { tenant_id: tenantId, is_active: true },
    select: { room: { select: { hostel_id: true } } },
    orderBy: { start_date: "desc" },
  });

  const derived = allocation?.room?.hostel_id ?? null;

  // ── Phase 2: Dual-Read Validation ──
  try {
    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      select: { hostel_id: true }
    });
    const stored = tenant?.hostel_id ?? null;
    
    if (derived !== stored) {
      console.log(`[HOSTEL_VALIDATION] tenant_id=${tenantId} derived=${derived || "NULL"} stored=${stored || "NULL"} ❌ MISMATCH`);
    } else {
      console.log(`[HOSTEL_VALIDATION] tenant_id=${tenantId} derived=${derived || "NULL"} stored=${stored || "NULL"} ✅`);
    }
  } catch (err) {
    console.error("[HOSTEL_VALIDATION] Failed to dual-read tenant", err);
  }

  return derived;
}

function contextMissing(entityType: string, entityId: string) {
  const err: any = new Error(
    `HOSTEL_CONTEXT_REQUIRED: Unable to resolve hostel context for ${entityType} ${entityId}. ` +
    "Operational preferences must be resolved from entity lineage, not owner fallback."
  );
  err.code = "HOSTEL_CONTEXT_REQUIRED";
  return err;
}

export async function getTenantOperationalContext(
  tenantId: string,
  ownerId: string,
  storedHostelId?: string | null,
): Promise<HostelOperationalContext> {
  const hostelId = storedHostelId || await resolveHostelIdFromTenant(tenantId);
  if (!hostelId) {
    await eventLog.log("HOSTEL_SCOPE_VIOLATION", ownerId, {
      entity_type: "Tenant",
      entity_id: tenantId,
      reason: "MISSING_HOSTEL_CONTEXT",
    });
    throw contextMissing("tenant", tenantId);
  }
  return getHostelOperationalContext(ownerId, hostelId);
}

export async function getPaymentOperationalContext(
  paymentId: string,
  ownerId: string,
  storedHostelId?: string | null,
  tenantId?: string | null,
): Promise<HostelOperationalContext> {
  let hostelId = storedHostelId || null;
  if (!hostelId && tenantId) {
    hostelId = await resolveHostelIdFromTenant(tenantId);
  }
  if (!hostelId) {
    await eventLog.log("HOSTEL_SCOPE_VIOLATION", ownerId, {
      entity_type: "Payment",
      entity_id: paymentId,
      reason: "MISSING_HOSTEL_CONTEXT",
    });
    throw contextMissing("payment", paymentId);
  }
  return getHostelOperationalContext(ownerId, hostelId);
}

export async function getObligationOperationalContext(
  obligation: { id: string; owner_id?: string | null; hostel_id?: string | null; allocation_id?: string | null; tenant_id: string },
): Promise<HostelOperationalContext> {
  const ownerId = obligation.owner_id || "";
  let hostelId = obligation.hostel_id || null;
  if (!hostelId) {
    hostelId = await resolveHostelIdFromObligation(obligation.id, obligation.allocation_id || null, obligation.tenant_id);
  }
  if (!hostelId) {
    await eventLog.log("HOSTEL_SCOPE_VIOLATION", ownerId || null, {
      entity_type: "RentObligation",
      entity_id: obligation.id,
      reason: "MISSING_HOSTEL_CONTEXT",
    });
    throw contextMissing("obligation", obligation.id);
  }
  return getHostelOperationalContext(ownerId, hostelId);
}

/**
 * Resolve hostelId from a rent obligation's allocation chain.
 *
 * Use this in the reminder service when iterating obligations.
 * Prefers allocation_id path (already on the obligation) for efficiency.
 */
export async function resolveHostelIdFromObligation(
  obligationId: string,
  allocationId: string | null,
  tenantId: string,
): Promise<string | null> {
  let derived: string | null = null;
  // Fast path: obligation has allocation_id
  if (allocationId) {
    const allocation = await prisma.roomAllocation.findUnique({
      where: { id: allocationId },
      select: { room: { select: { hostel_id: true } } },
    });
    if (allocation?.room?.hostel_id) derived = allocation.room.hostel_id;
  }

  // Fallback: resolve from tenant's current active allocation
  if (!derived) {
    derived = await resolveHostelIdFromTenant(tenantId);
  }

  // ── Phase 2: Dual-Read Validation ──
  try {
    const obligation = await prisma.rent_obligations.findUnique({
      where: { id: obligationId },
      select: { hostel_id: true }
    });
    const stored = obligation?.hostel_id ?? null;
    
    if (derived !== stored) {
      console.log(`[HOSTEL_VALIDATION] obligation_id=${obligationId} derived=${derived || "NULL"} stored=${stored || "NULL"} ❌ MISMATCH`);
    } else {
      console.log(`[HOSTEL_VALIDATION] obligation_id=${obligationId} derived=${derived || "NULL"} stored=${stored || "NULL"} ✅`);
    }
  } catch (err) {
    console.error("[HOSTEL_VALIDATION] Failed to dual-read obligation", err);
  }

  return derived;
}

/**
 * Build a hostelId → HostelOperationalContext map for a batch of hostel IDs.
 *
 * Used by the reminder service to batch-load hostel configs for all obligations
 * in one query instead of N individual lookups.
 */
export async function batchGetHostelContexts(
  hostelIds: string[],
  ownerId?: string,
): Promise<Map<string, HostelOperationalContext>> {
  const uniqueIds = Array.from(new Set(hostelIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();

  const hostels = await prisma.hostels.findMany({
    where: {
      id: { in: uniqueIds },
      status: { in: ["ACTIVE", "INACTIVE"] },
      ...(ownerId ? { owner_id: ownerId } : {}),
    },
    select: {
      id: true,
      owner_id: true,
      name: true,
      address: true,
      city: true,
      state: true,
      pincode: true,
      phone: true,
      gst_number: true,
      upi_id: true,
      logo_url: true,
      receipt_prefix: true,
      timezone: true,
      currency: true,
      status: true,
      is_active: true,
      preferences_config: true,
      rent_cycle: true,
      auto_rent_day: true,
    },
  });

  const map = new Map<string, HostelOperationalContext>();
  for (const hostel of hostels) {
    map.set(hostel.id, {
      hostel: {
        ...hostel,
        is_active: hostel.status === "ACTIVE",
      } as HostelOperationalContext["hostel"],
      prefs: resolvePreferences(hostel),
    });
  }
  return map;
}
