import { prisma } from "@/lib/db";
import { normalizeWhatsAppPhone } from "@/lib/services/notifications/providers/whatsapp/meta-provider";

/** Normalization that answers "not a usable number" instead of throwing. */
function safeNormalizeWhatsApp(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return normalizeWhatsAppPhone(value);
  } catch {
    return "";
  }
}

/**
 * Reading and writing guardian-verification state. The decisions live next
 * door in `guardian-verification.ts`, which is pure; this is the half that
 * touches the database.
 */

export const GUARDIAN_ONBOARDING_PURPOSE = "ParentVerify";

/**
 * Is this tenancy's guardian number proved?
 *
 * ## The scoping this fixes
 *
 * The check used to be `{ phone, purpose: 'ParentVerify', status: 'VERIFIED' }`
 * — matched on the phone number alone, across every tenancy, with no expiry.
 * So a number verified once for anybody read as verified for everybody,
 * permanently. That was survivable while verification was an unconditional
 * gate that every tenant cleared at the desk anyway: the check's answer only
 * ever decided whether to ask for a code that was about to be entered.
 *
 * ADR-212 makes the answer durable and visible — it drives a badge on the
 * owner's tenant record and decides who gets chased. A badge that can be wrong
 * is worse than no badge, so the proof is now scoped to the tenancy it was
 * taken for.
 *
 * ## Why NULL still passes
 *
 * Rows written before ADR-212 have no `tenant_id` and cannot honestly be given
 * one — nothing in the OTP trail records which tenancy a code was sent for.
 * Backfilling by phone would reproduce the exact assumption this change
 * removes, but dressed up as data. So legacy rows are accepted as they were,
 * and only new proofs carry the stronger guarantee. The population of NULL
 * rows stops growing the day this ships.
 */
export async function isGuardianPhoneVerifiedForTenant(
  tenantId: string,
  guardianPhone: string | null | undefined,
): Promise<boolean> {
  const phone = safeNormalizeWhatsApp(guardianPhone || "");
  if (!phone) return false;

  const proof = await prisma.phoneVerificationOtp.findFirst({
    where: {
      phone,
      purpose: GUARDIAN_ONBOARDING_PURPOSE,
      status: "VERIFIED",
      // This tenancy's own proof, or a pre-ADR-212 row that has no tenancy.
      OR: [{ tenant_id: tenantId }, { tenant_id: null }],
    },
    select: { id: true },
  });

  return Boolean(proof);
}
