/**
 * "Confirm your ward" — asking the guardian directly instead of via the tenant.
 *
 * ## Why this reuses the OTP trail instead of adding a table
 *
 * A pending request needs somewhere to live: something that says *this number
 * was asked about this tenancy, and has until this time to answer*. That is
 * precisely a `phone_verification_otps` row — phone, purpose, status, expiry,
 * and (since ADR-212) the tenancy. Adding a `guardian_verification_requests`
 * table beside it would create a second record of the same event, and then a
 * second definition of "verified" that has to agree with the first. The whole
 * reason `guardian-access.ts` reads the OTP trail rather than a status column
 * is to avoid exactly that.
 *
 * So a request is an OTP whose code is never sent to anybody. The hash is of a
 * random value the tenant cannot see and the guardian is never shown; the
 * button tap is what flips the row to VERIFIED. Every existing reader —
 * `isGuardianPhoneVerifiedForTenant`, `guardian-access.isGuardianVerified` —
 * then sees the proof without knowing or caring how it was obtained, which is
 * the point.
 *
 * Never throws. A tenant asking for help must not get an error page because
 * WhatsApp was down.
 */

import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { whatsAppTemplateDeliveryService } from "../whatsapp-template-delivery";
import {
  buildGuardianVerifyRequestPayload,
  guardianVerifyRequestTemplateLanguage,
  guardianVerifyRequestTemplateName,
  isGuardianVerifyRequestConfigured,
  GUARDIAN_VERIFY_REQUEST_TEMPLATE,
} from "../providers/whatsapp/guardian-verify-request-template-contract";
import { normalizeWhatsAppPhone } from "../providers/whatsapp";
import { GUARDIAN_ONBOARDING_PURPOSE } from "@/src/services/tenants/guardian-verification-store";
import type { PendingGuardianRequest } from "./guardian-confirm-resolution";

const logger = getLogger("whatsapp.command-center.guardian-verify-request");

export type GuardianVerifyRequestResult = {
  sent: boolean;
  /**
   * True when the caller should offer the OTP relay instead. Distinguished from
   * a plain failure because the UI says something different: "we couldn't reach
   * them, try the code" rather than "something went wrong".
   */
  fallbackToOtp: boolean;
  reason?:
    | "TENANT_NOT_FOUND"
    | "NO_GUARDIAN_PHONE"
    | "GUARDIAN_SAME_AS_RESIDENT"
    | "ALREADY_VERIFIED"
    | "TEMPLATE_NOT_CONFIGURED"
    | "SEND_FAILED";
};

function safeNormalize(phone: string): string {
  try {
    return normalizeWhatsAppPhone(phone);
  } catch {
    return String(phone || "").replace(/\D/g, "");
  }
}

export async function sendGuardianVerifyRequest(tenantId: string): Promise<GuardianVerifyRequestResult> {
  try {
    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        owner_id: true,
        hostel_id: true,
        phone_1: true,
        phone_2: true,
        guardian_name: true,
        guardian_phone: true,
        profiles: { select: { name: true, phone: true } },
        hostels: { select: { name: true } },
      },
    });

    if (!tenant) return { sent: false, fallbackToOtp: false, reason: "TENANT_NOT_FOUND" };

    const guardianPhone = (tenant.guardian_phone || tenant.phone_2 || "").trim();
    if (!guardianPhone) return { sent: false, fallbackToOtp: false, reason: "NO_GUARDIAN_PHONE" };

    const residentPhone = (tenant.phone_1 || tenant.profiles?.phone || "").trim();
    if (residentPhone && safeNormalize(guardianPhone) === safeNormalize(residentPhone)) {
      // One handset in both fields. Asking someone to confirm that they are
      // their own guardian proves nothing about anybody.
      return { sent: false, fallbackToOtp: false, reason: "GUARDIAN_SAME_AS_RESIDENT" };
    }

    const normalized = safeNormalize(guardianPhone);

    const alreadyVerified = await prisma.phoneVerificationOtp.findFirst({
      where: {
        phone: normalized,
        purpose: GUARDIAN_ONBOARDING_PURPOSE,
        status: "VERIFIED",
        OR: [{ tenant_id: tenant.id }, { tenant_id: null }],
      },
      select: { id: true },
    });
    if (alreadyVerified) return { sent: false, fallbackToOtp: false, reason: "ALREADY_VERIFIED" };

    // Checked before the row is written, so a template that Meta has not
    // approved yet leaves no orphaned PENDING request behind to confuse the
    // reply handler.
    if (!isGuardianVerifyRequestConfigured()) {
      return { sent: false, fallbackToOtp: true, reason: "TEMPLATE_NOT_CONFIGURED" };
    }

    const expiresAt = new Date(Date.now() + GUARDIAN_VERIFY_REQUEST_TEMPLATE.validityHours * 60 * 60 * 1000);

    // Supersede any earlier outstanding request for this pair. `verifyPhoneOtp`
    // resolves the newest PENDING row for a (phone, purpose), so leaving stale
    // ones open would make a tenant's second attempt race their first.
    await prisma.phoneVerificationOtp.updateMany({
      where: {
        phone: normalized,
        purpose: GUARDIAN_ONBOARDING_PURPOSE,
        status: "PENDING",
        tenant_id: tenant.id,
      },
      data: { status: "EXPIRED", failure_reason: "superseded by a newer guardian confirmation request" },
    });

    const pending = await prisma.phoneVerificationOtp.create({
      data: {
        phone: normalized,
        // A hash of a value nobody is ever shown. The button is the proof; this
        // column is NOT NULL and must hold something, and something random is
        // the only honest thing to put in it.
        otp_hash: crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex"),
        purpose: GUARDIAN_ONBOARDING_PURPOSE,
        status: "PENDING",
        expires_at: expiresAt,
        tenant_id: tenant.id,
      },
      select: { id: true },
    });

    const result = await whatsAppTemplateDeliveryService.send({
      phone: guardianPhone,
      templateName: guardianVerifyRequestTemplateName(),
      languageCode: guardianVerifyRequestTemplateLanguage(),
      bodyParameters: buildGuardianVerifyRequestPayload({
        guardianName: tenant.guardian_name,
        tenantName: tenant.profiles?.name,
        hostelName: tenant.hostels?.name,
      }),
      // Keyed on the request, not the pair: unlike the activation announcement,
      // asking again is a legitimate thing for a tenant to do when the first
      // ask went unanswered.
      idempotencyKey: `guardian_verify_request:${pending.id}`,
      tenantId: tenant.id,
      hostelId: tenant.hostel_id,
      ownerId: tenant.owner_id || undefined,
    });

    if (result.skipped) {
      return { sent: false, fallbackToOtp: true, reason: "SEND_FAILED" };
    }

    logger.info("guardian_verify_request.sent", {
      tenant_id: tenant.id,
      request_id: pending.id,
      expires_at: expiresAt.toISOString(),
    });

    return { sent: true, fallbackToOtp: false };
  } catch (error: any) {
    logger.error("guardian_verify_request.failed", {
      tenant_id: tenantId,
      error: error?.message || String(error),
    });
    // The OTP relay still works, so offer it rather than leaving the tenant
    // with nothing.
    return { sent: false, fallbackToOtp: true, reason: "SEND_FAILED" };
  }
}

/**
 * Every outstanding confirmation request for this handset, oldest first.
 *
 * Oldest first because the order is what a picker numbers, and a list that
 * reorders itself between being shown and being answered is a way to confirm
 * the wrong resident.
 */
export async function listPendingGuardianRequests(phone: string): Promise<PendingGuardianRequest[]> {
  const normalized = safeNormalize(phone);
  if (!normalized) return [];

  const rows = await prisma.phoneVerificationOtp.findMany({
    where: {
      phone: normalized,
      purpose: GUARDIAN_ONBOARDING_PURPOSE,
      status: "PENDING",
      expires_at: { gt: new Date() },
      tenant_id: { not: null },
    },
    orderBy: { created_at: "asc" },
    select: {
      id: true,
      tenant_id: true,
      tenants: {
        select: {
          id: true,
          profiles: { select: { name: true } },
          hostels: { select: { name: true } },
        },
      },
    },
  });

  return rows
    .filter((row: any) => row.tenants)
    .map((row: any) => ({
      requestId: row.id,
      tenantId: row.tenant_id as string,
      tenantName: row.tenants?.profiles?.name || "your ward",
      hostelName: row.tenants?.hostels?.name || "their hostel",
    }));
}

/**
 * Turn one outstanding request into proof.
 *
 * Conditional on the row still being PENDING, so two taps in quick succession
 * — which a WhatsApp button makes easy — produce one verification rather than
 * two, and the second is reported as already-done instead of failing.
 */
export async function confirmGuardianRequest(requestId: string): Promise<boolean> {
  const confirmed = await prisma.phoneVerificationOtp.updateMany({
    where: { id: requestId, status: "PENDING", expires_at: { gt: new Date() } },
    data: {
      status: "VERIFIED",
      verified_at: new Date(),
      provider_status: "VERIFIED_BY_GUARDIAN_REPLY",
    },
  });
  return confirmed.count === 1;
}
