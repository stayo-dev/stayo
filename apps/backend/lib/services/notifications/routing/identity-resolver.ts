import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { normalizeWhatsAppPhone } from "@/lib/services/notifications/providers/whatsapp";
import {
  ResidentMatch,
  ResolvedResident,
  SenderIdentity,
  SenderRole,
  permissionsForRoles,
} from "./types";

const logger = getLogger("whatsapp.identity");

/**
 * Phone numbers are stored inconsistently across this schema (with and without
 * the country code, with and without `+`), so every lookup matches on a set of
 * candidates rather than one canonical form. Same rule the balance command has
 * always used — kept identical here so identity and resolution agree.
 */
export function getPhoneCandidates(rawPhone: string): string[] {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  if (!digits) return [];
  const candidates = [digits, rawPhone];
  if (digits.length === 12 && digits.startsWith("91")) {
    const tenDigits = digits.slice(2);
    candidates.push(tenDigits);
    candidates.push(`+91${tenDigits}`);
  }
  if (digits.length === 10) {
    candidates.push(`91${digits}`);
    candidates.push(`+91${digits}`);
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

/** OWNER beats TENANT beats ADMIN/STAFF — most specific relationship to the message wins. */
const ROLE_PRECEDENCE: SenderRole[] = ["OWNER", "TENANT", "ADMIN", "STAFF"];

function pickPrimaryRole(roles: SenderRole[]): SenderRole {
  for (const role of ROLE_PRECEDENCE) {
    if (roles.includes(role)) return role;
  }
  return "UNKNOWN";
}

async function findVerifiedOwner(normalizedPhone: string) {
  try {
    const rows = await prisma.$queryRaw<Array<{ owner_id: string }>>`
      SELECT owner_id::text
      FROM owner_whatsapp_identities
      WHERE phone_number = ${normalizedPhone}
        AND is_verified = true
      LIMIT 1
    `;
    return rows[0] || null;
  } catch (error: any) {
    // Same tolerance the owner assistant has: a deployment that hasn't run the
    // migration should degrade to "not an owner", not 500 the whole webhook.
    if (error?.code === "P2010" && String(error?.meta?.code || "").toUpperCase() === "42P01") {
      logger.warn("whatsapp.identity.owner_table_missing", {
        reason: "owner_whatsapp_identities migration has not been applied",
      });
      return null;
    }
    throw error;
  }
}

/**
 * Which field matched decides how much we trust the classification: a message
 * from the resident's own handset is not the same evidence as one from the
 * guardian's, even though both resolve to the same tenant.
 */
function classifyMatch(tenant: any, candidateSet: Set<string>): ResidentMatch {
  for (const field of ["phone_1", "phone_2", "phone_3"]) {
    if (tenant[field] && candidateSet.has(tenant[field])) return "OWN_PHONE";
  }
  if (tenant.profiles?.phone && candidateSet.has(tenant.profiles.phone)) return "PROFILE_PHONE";
  return "GUARDIAN_PHONE";
}

async function findResidents(candidates: string[]): Promise<ResolvedResident[]> {
  if (candidates.length === 0) return [];
  const matches = await prisma.tenants.findMany({
    where: {
      OR: [
        { phone_1: { in: candidates } },
        { phone_2: { in: candidates } },
        { phone_3: { in: candidates } },
        { guardian_phone: { in: candidates } },
        { profiles: { phone: { in: candidates } } },
      ],
    },
    include: { profiles: true },
  });

  const candidateSet = new Set(candidates);

  // Same status filter the balance flow applies — a moved-out tenant is not a
  // current tenant for routing purposes.
  return matches
    .filter((tenant: any) => tenant.status === "ACTIVE" || tenant.status === "INVITED")
    .map((tenant: any) => ({
      tenantId: String(tenant.id),
      hostelId: String(tenant.hostel_id),
      name: tenant.profiles?.name || tenant.guardian_name || null,
      status: String(tenant.status),
      matchedVia: classifyMatch(tenant, candidateSet),
    }));
}

async function findOwnerHostels(ownerId: string): Promise<string[]> {
  const rows = await prisma.hostels.findMany({
    where: { owner_id: ownerId },
    select: { id: true },
  });
  return rows.map((row: any) => String(row.id));
}

/** Exactly one, or nothing. Never "the first one" — that bug has bitten here before. */
function onlyOne(values: string[]): string | null {
  const unique = Array.from(new Set(values));
  return unique.length === 1 ? unique[0] : null;
}

function scoreConfidence(roles: SenderRole[], residents: ResolvedResident[]): number {
  if (roles.includes("OWNER")) return 1; // an explicitly verified link
  if (roles.includes("ADMIN")) return 0.9;
  if (roles.includes("TENANT")) {
    return residents.some((resident) => resident.matchedVia !== "GUARDIAN_PHONE") ? 0.95 : 0.6;
  }
  return 0;
}

async function findAdminProfile(candidates: string[]) {
  if (candidates.length === 0) return null;
  const profile = await prisma.profiles.findFirst({
    where: { phone: { in: candidates }, role: "ADMIN" },
    select: { id: true, name: true },
  });
  return profile || null;
}

/**
 * Who is messaging us? Resolution never throws on "nobody" — an unrecognised
 * number is a first-class UNKNOWN identity, because the pipeline still owes it
 * a helpful reply (and because LINK has to work before anyone is linked).
 */
export async function resolveSenderIdentity(phone: string): Promise<SenderIdentity> {
  const normalizedPhone = normalizeWhatsAppPhone(phone);
  const candidates = getPhoneCandidates(phone);

  const [owner, residents, admin] = await Promise.all([
    findVerifiedOwner(normalizedPhone),
    findResidents(candidates),
    findAdminProfile(candidates),
  ]);

  const roles: SenderRole[] = [];
  if (owner) roles.push("OWNER");
  if (residents.length > 0) roles.push("TENANT");
  if (admin) roles.push("ADMIN");

  const ownerHostelIds = owner ? await findOwnerHostels(owner.owner_id) : [];
  const effectiveRoles: SenderRole[] = roles.length > 0 ? roles : ["UNKNOWN"];
  const tenantIds = residents.map((resident) => resident.tenantId);
  const hostelIds = Array.from(new Set([...residents.map((r) => r.hostelId), ...ownerHostelIds]));

  const identity: SenderIdentity = {
    phone,
    normalizedPhone,
    role: pickPrimaryRole(roles),
    roles: effectiveRoles,
    permissions: permissionsForRoles(effectiveRoles),

    ownerId: owner?.owner_id || null,
    tenantId: onlyOne(tenantIds),
    tenantIds,
    hostelId: onlyOne(hostelIds),
    hostelIds,
    residents,

    profileId: admin?.id || null,
    displayName: admin?.name || residents[0]?.name || null,

    confidence: scoreConfidence(effectiveRoles, residents),
    resolvedAt: new Date().toISOString(),
  };

  logger.info("whatsapp.identity.resolved", {
    phone,
    normalized_phone: normalizedPhone,
    role: identity.role,
    roles: identity.roles,
    permissions: identity.permissions,
    tenant_count: identity.tenantIds.length,
    hostel_count: identity.hostelIds.length,
    unambiguous_tenant: Boolean(identity.tenantId),
    has_owner_link: Boolean(identity.ownerId),
    confidence: identity.confidence,
  });

  return identity;
}
