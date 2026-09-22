import { prisma } from "@/lib/db";
import { isGuardianVerified } from "@/lib/services/notifications/command-center/guardian-access";
import { normalizeWhatsAppPhone } from "@/lib/services/notifications/providers/whatsapp";
import { consentStateOf, type ConsentRecord, type ConsentState } from "./stay-guardian-consent-state";

/**
 * The tenant's decision about guardian stay updates (ADR-233).
 *
 * Stay owns the consent record; `notifications/` owns the sending. This module
 * is the boundary between them.
 */

/** `normalizeWhatsAppPhone` throws on malformed input; comparison must not. */
export function safeNormalize(phone: string): string {
  try {
    return normalizeWhatsAppPhone(phone);
  } catch {
    return String(phone || "").replace(/\D/g, "");
  }
}

/** What the tenant app needs to decide whether to show the consent sheet. */
export interface GuardianConsentView {
  /** There is a guardian we could actually message: present, verified, not the resident. */
  eligible: boolean;
  name: string | null;
  /**
   * `PHONE_CHANGED` is reported as `UNASKED`: the stored decision is about a
   * different person, so the tenant must be asked again. The policy keeps the
   * distinction for its logs; the UI only needs to know whether to ask.
   */
  consent: "UNASKED" | "GRANTED" | "DECLINED" | "REVOKED" | "STOPPED";
}

type TenantGuardianFields = {
  id: string;
  hostel_id: string | null;
  phone_1: string | null;
  phone_2: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  profiles: { name: string | null; phone: string | null } | null;
};

async function loadTenant(tenantId: string): Promise<TenantGuardianFields | null> {
  return (await (prisma as any).tenants.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      hostel_id: true,
      phone_1: true,
      phone_2: true,
      guardian_name: true,
      guardian_phone: true,
      profiles: { select: { name: true, phone: true } },
    },
  })) as TenantGuardianFields | null;
}

/**
 * `phone_2` and `guardian_phone` are kept in step by `tenant-service`, but
 * activation writes `phone_2` first on some paths — `guardian-activation.ts`
 * reads both for the same reason.
 */
export function guardianPhoneOf(tenant: TenantGuardianFields): string {
  return (tenant.guardian_phone || tenant.phone_2 || "").trim();
}

export function residentPhoneOf(tenant: TenantGuardianFields): string {
  return (tenant.phone_1 || tenant.profiles?.phone || "").trim();
}

export async function readGuardianConsentRow(tenantId: string): Promise<ConsentRecord | null> {
  const row = await (prisma as any).stay_guardian_consent.findUnique({
    where: { tenant_id: tenantId },
    select: { granted: true, guardian_phone: true, revoked_at: true, stopped_at: true },
  });
  if (!row) return null;
  return {
    granted: row.granted,
    guardianPhone: row.guardian_phone,
    revokedAt: row.revoked_at,
    stoppedAt: row.stopped_at,
  };
}

function viewFrom(state: ConsentState): GuardianConsentView["consent"] {
  return state === "PHONE_CHANGED" ? "UNASKED" : state;
}

export async function guardianViewFor(tenantId: string): Promise<GuardianConsentView | null> {
  const tenant = await loadTenant(tenantId);
  if (!tenant) return null;

  const guardianPhone = guardianPhoneOf(tenant);
  // No guardian on file: there is nothing to consent about, and no sheet to show.
  if (!guardianPhone) return null;

  const row = await readGuardianConsentRow(tenantId);
  const consent = viewFrom(consentStateOf(row, guardianPhone, safeNormalize));

  const residentPhone = residentPhoneOf(tenant);
  const sameHandset = Boolean(residentPhone) && safeNormalize(guardianPhone) === safeNormalize(residentPhone);
  // Only ask the verification question when it can change the answer — it is a
  // database round trip on a route the QR screen hits on every scan.
  const verified = sameHandset ? false : await isGuardianVerified(guardianPhone);

  return {
    eligible: !sameHandset && verified,
    name: (tenant.guardian_name || "").trim() || null,
    consent,
  };
}

export async function recordGuardianConsent(input: {
  tenantId: string;
  granted: boolean;
  source: "APP" | "QR";
}): Promise<GuardianConsentView | null> {
  const tenant = await loadTenant(input.tenantId);
  if (!tenant || !tenant.hostel_id) return null;

  const guardianPhone = guardianPhoneOf(tenant);
  if (!guardianPhone) return null;

  const now = new Date();
  await (prisma as any).stay_guardian_consent.upsert({
    where: { tenant_id: input.tenantId },
    create: {
      tenant_id: input.tenantId,
      hostel_id: tenant.hostel_id,
      granted: input.granted,
      guardian_phone: guardianPhone,
      decided_at: now,
      source: input.source,
      updated_at: now,
    },
    update: {
      granted: input.granted,
      // Re-consenting after the number changed is consent about the new person.
      guardian_phone: guardianPhone,
      decided_at: now,
      // A fresh decision clears the tenant's own revocation …
      revoked_at: null,
      // … but never `stopped_at`. A guardian who asked to be left alone is not
      // re-subscribed by the tenant changing their mind.
      source: input.source,
      updated_at: now,
    },
  });

  return guardianViewFor(input.tenantId);
}

/** The tenant switched it off. `updateMany` so a missing row is a no-op, not a throw. */
export async function revokeGuardianConsent(tenantId: string): Promise<void> {
  const now = new Date();
  await (prisma as any).stay_guardian_consent.updateMany({
    where: { tenant_id: tenantId },
    data: { revoked_at: now, updated_at: now },
  });
}

/** The guardian replied STOP. */
export async function stopGuardianConsent(tenantId: string): Promise<void> {
  const now = new Date();
  await (prisma as any).stay_guardian_consent.updateMany({
    where: { tenant_id: tenantId },
    data: { stopped_at: now, updated_at: now },
  });
}
